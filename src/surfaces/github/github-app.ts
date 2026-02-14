/**
 * GitHub App Surface — Webhook Receiver & GitHub REST API Client
 *
 * Full GitHub App integration surface for CortexOS. Receives webhooks via
 * an embedded HTTP server, verifies HMAC-SHA256 signatures, routes events,
 * and interacts with the GitHub REST API using JWT-based App authentication.
 *
 * Features:
 * - Webhook signature verification (x-hub-signature-256)
 * - GitHub App JWT generation (RS256 via node:crypto)
 * - Installation token management with automatic refresh
 * - PR analysis pipeline with CriticAgent integration
 * - Issue triage and labeling
 * - Comment posting and check run creation
 *
 * Zero npm dependencies — uses only Node.js built-ins.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createHmac, createSign, timingSafeEqual, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  Surface,
  SurfaceType,
  GitHubAppConfig,
  GitHubWebhookPayload,
  PRPayload,
  IssuePayload,
  IssueCommentPayload,
  PushPayload,
  GitHubAppStats,
} from '../types.js';
import { PRAnalyzer, type PRAnalysis } from './pr-analyzer.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const GITHUB_API_BASE = 'https://api.github.com';
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiry
const JWT_EXPIRY_SECONDS = 600; // 10 minutes (GitHub max)

// ═══════════════════════════════════════════════════════════════
// GITHUB APP SURFACE
// ═══════════════════════════════════════════════════════════════

export class GitHubApp extends EventEmitter implements Surface {
  readonly id: string;
  readonly type: SurfaceType = 'github';

  private server: Server | null = null;
  private config: Required<GitHubAppConfig>;
  private running = false;
  private startTime = 0;

  // Stats
  private eventsReceived = 0;
  private eventsProcessed = 0;
  private errorCount = 0;
  private webhooksReceived = 0;
  private prsAnalyzed = 0;
  private issuesTriaged = 0;
  private commentsPosted = 0;

  // Installation token cache: installationId → { token, expiresAt }
  private installationTokens: Map<number, { token: string; expiresAt: number }> = new Map();

  // Task handler (wired to CortexOS engine)
  private taskHandler: ((event: string, payload: unknown) => Promise<unknown>) | null = null;

  // PR Analyzer
  private prAnalyzer: PRAnalyzer;

  constructor(config: GitHubAppConfig) {
    super();
    this.id = `gh_${randomUUID().slice(0, 8)}`;
    this.config = {
      appId: config.appId,
      privateKey: config.privateKey,
      webhookSecret: config.webhookSecret,
      port: config.port ?? 3300,
      hostname: config.hostname ?? '0.0.0.0',
    };
    this.prAnalyzer = new PRAnalyzer();
  }

  // ─── Lifecycle ─────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return;

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          this.errorCount++;
          this.emit('surface:error', {
            surfaceId: this.id,
            error: err instanceof Error ? err.message : String(err),
            timestamp: Date.now(),
          });
        });
      });

      this.server.on('error', (err) => {
        this.errorCount++;
        this.emit('surface:error', {
          surfaceId: this.id,
          error: err.message,
          timestamp: Date.now(),
        });
        reject(err);
      });

      this.server.listen(this.config.port, this.config.hostname, () => {
        this.running = true;
        this.startTime = Date.now();
        this.emit('surface:started', {
          surfaceId: this.id,
          type: this.type,
          port: this.config.port,
          timestamp: Date.now(),
        });
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          this.running = false;
          this.installationTokens.clear();
          this.emit('surface:stopped', {
            surfaceId: this.id,
            type: this.type,
            timestamp: Date.now(),
          });
          resolve();
        });
      } else {
        this.running = false;
        resolve();
      }
    });
  }

  isRunning(): boolean {
    return this.running;
  }

  getStats(): GitHubAppStats {
    return {
      type: this.type,
      isRunning: this.running,
      eventsReceived: this.eventsReceived,
      eventsProcessed: this.eventsProcessed,
      errors: this.errorCount,
      uptime: this.startTime > 0 ? Date.now() - this.startTime : 0,
      webhooksReceived: this.webhooksReceived,
      prsAnalyzed: this.prsAnalyzed,
      issuesTriaged: this.issuesTriaged,
      commentsPosted: this.commentsPosted,
    };
  }

  // ─── Configuration ─────────────────────────────────────────

  /**
   * Set the task handler for CortexOS engine integration.
   * Called when a webhook event needs to be processed by the engine.
   */
  setTaskHandler(handler: (event: string, payload: unknown) => Promise<unknown>): void {
    this.taskHandler = handler;
  }

  // ─── HTTP Request Handling ─────────────────────────────────

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const path = url.pathname;

    // Health check
    if (path === '/health' && req.method === 'GET') {
      this.jsonResponse(res, 200, {
        status: 'ok',
        surface: 'github',
        webhooksReceived: this.webhooksReceived,
      });
      return;
    }

    // Webhook endpoint
    if (path === '/webhook' && req.method === 'POST') {
      await this.handleWebhook(req, res);
      return;
    }

    this.jsonResponse(res, 404, { error: 'Not found' });
  }

  private async handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.eventsReceived++;
    this.webhooksReceived++;

    // Read body
    const rawBody = await this.readBody(req);

    // Verify signature
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    if (!signature || !this.verifyWebhookSignature(rawBody, signature)) {
      this.errorCount++;
      this.jsonResponse(res, 401, { error: 'Invalid signature' });
      return;
    }

    // Parse payload
    let payload: GitHubWebhookPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      this.errorCount++;
      this.jsonResponse(res, 400, { error: 'Invalid JSON payload' });
      return;
    }

    // Determine event type from header
    const eventType = req.headers['x-github-event'] as string | undefined;
    const deliveryId = req.headers['x-github-delivery'] as string | undefined;

    // Acknowledge immediately (webhook processing is async)
    this.jsonResponse(res, 200, {
      accepted: true,
      deliveryId,
      event: eventType,
    });

    // Emit raw webhook event
    this.emit('surface:github:webhook', {
      event: eventType,
      deliveryId,
      action: payload.action,
      repository: payload.repository?.full_name,
      sender: payload.sender?.login,
      timestamp: Date.now(),
    });

    // Route to specific handler
    this.routeWebhookEvent(eventType, payload).catch((err) => {
      this.errorCount++;
      this.emit('surface:error', {
        surfaceId: this.id,
        error: `Webhook handling failed: ${err instanceof Error ? err.message : String(err)}`,
        event: eventType,
        timestamp: Date.now(),
      });
    });
  }

  // ─── Webhook Routing ───────────────────────────────────────

  private async routeWebhookEvent(
    eventType: string | undefined,
    payload: GitHubWebhookPayload,
  ): Promise<void> {
    switch (eventType) {
      case 'pull_request':
        await this.handlePullRequest(payload as PRPayload);
        break;

      case 'issues':
        await this.handleIssue(payload as IssuePayload);
        break;

      case 'issue_comment':
        await this.handleIssueComment(payload as IssueCommentPayload);
        break;

      case 'push':
        await this.handlePush(payload as PushPayload);
        break;

      case 'check_run':
        await this.handleCheckRun(payload);
        break;

      default:
        // Unknown event type — forward to task handler if available
        if (this.taskHandler) {
          await this.taskHandler(`github:${eventType}`, payload);
        }
        break;
    }

    this.eventsProcessed++;
  }

  // ─── Event Handlers ────────────────────────────────────────

  private async handlePullRequest(payload: PRPayload): Promise<void> {
    const { action, pull_request: pr, repository } = payload;

    if (!repository || !pr) return;

    const owner = repository.owner.login;
    const repo = repository.name;

    // Analyze PRs on open/sync
    if (action === 'opened' || action === 'synchronize') {
      try {
        // Fetch the diff
        const installationId = payload.installation?.id;
        const token = installationId
          ? await this.getInstallationToken(installationId)
          : undefined;

        const diff = await this.fetchPRDiff(owner, repo, pr.number, token);

        // Run PR analysis
        const analysis = this.prAnalyzer.analyzePR({
          title: pr.title,
          body: pr.body ?? '',
          diff,
          files: this.extractFilesFromDiff(diff),
          headRef: pr.head.ref,
          baseRef: pr.base.ref,
          author: pr.user.login,
          isDraft: pr.draft,
        });

        this.prsAnalyzed++;

        // Generate and post review comment
        const reviewComment = this.prAnalyzer.generateReviewComment(analysis);
        if (token && reviewComment) {
          await this.postComment(owner, repo, pr.number, reviewComment, token);
        }

        // Suggest labels
        const suggestedLabels = this.prAnalyzer.suggestLabels({
          title: pr.title,
          body: pr.body ?? '',
          diff,
          files: this.extractFilesFromDiff(diff),
          headRef: pr.head.ref,
          baseRef: pr.base.ref,
          author: pr.user.login,
          isDraft: pr.draft,
        });

        if (token && suggestedLabels.length > 0) {
          await this.addLabels(owner, repo, pr.number, suggestedLabels, token);
        }

        // Create a check run if configured
        if (token) {
          await this.createCheckRun(
            owner,
            repo,
            pr.head.sha,
            'CortexOS PR Analysis',
            analysis.overallScore >= 70 ? 'success' : 'neutral',
            `Score: ${analysis.overallScore}/100\n\n${analysis.summary}`,
            token,
          );
        }

        this.emit('surface:github:pr:analyzed', {
          owner,
          repo,
          number: pr.number,
          score: analysis.overallScore,
          issues: analysis.issues.length,
          suggestions: analysis.suggestions.length,
          timestamp: Date.now(),
        });
      } catch (err) {
        this.errorCount++;
        this.emit('surface:error', {
          surfaceId: this.id,
          error: `PR analysis failed: ${err instanceof Error ? err.message : String(err)}`,
          pr: `${owner}/${repo}#${pr.number}`,
          timestamp: Date.now(),
        });
      }
    }

    // Forward to task handler
    if (this.taskHandler) {
      await this.taskHandler('github:pull_request', payload);
    }
  }

  private async handleIssue(payload: IssuePayload): Promise<void> {
    const { action, issue, repository } = payload;

    if (!repository || !issue) return;

    // Auto-triage on open
    if (action === 'opened') {
      this.issuesTriaged++;

      this.emit('surface:github:issue:triaged', {
        owner: repository.owner.login,
        repo: repository.name,
        number: issue.number,
        title: issue.title,
        labels: issue.labels.map((l) => l.name),
        timestamp: Date.now(),
      });
    }

    // Forward to task handler
    if (this.taskHandler) {
      await this.taskHandler('github:issues', payload);
    }
  }

  private async handleIssueComment(payload: IssueCommentPayload): Promise<void> {
    const { action, comment, issue } = payload;

    if (action !== 'created' || !comment) return;

    // Check if this is a command (e.g., "/cortex review")
    const body = comment.body.trim();
    if (body.startsWith('/cortex') || body.startsWith('/ctx')) {
      const command = body.replace(/^\/(?:cortex|ctx)\s*/, '').trim();

      this.emit('surface:github:command', {
        command,
        issueNumber: issue.number,
        isPR: !!issue.pull_request,
        user: comment.user.login,
        repository: payload.repository?.full_name,
        timestamp: Date.now(),
      });

      // Forward command to task handler
      if (this.taskHandler) {
        await this.taskHandler('github:command', {
          command,
          payload,
        });
      }
    }

    // Forward to task handler
    if (this.taskHandler) {
      await this.taskHandler('github:issue_comment', payload);
    }
  }

  private async handlePush(payload: PushPayload): Promise<void> {
    // Forward to task handler
    if (this.taskHandler) {
      await this.taskHandler('github:push', payload);
    }
  }

  private async handleCheckRun(payload: GitHubWebhookPayload): Promise<void> {
    // Forward to task handler
    if (this.taskHandler) {
      await this.taskHandler('github:check_run', payload);
    }
  }

  // ─── GitHub REST API Methods ───────────────────────────────

  /**
   * Post a comment on an issue or pull request.
   */
  async postComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string,
    token?: string,
  ): Promise<void> {
    const authToken = token ?? await this.getDefaultToken();
    if (!authToken) return;

    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${authToken}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ body }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    this.commentsPosted++;

    this.emit('surface:github:comment:posted', {
      owner,
      repo,
      issueNumber,
      timestamp: Date.now(),
    });
  }

  /**
   * Create a check run on a commit.
   */
  async createCheckRun(
    owner: string,
    repo: string,
    headSha: string,
    name: string,
    conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required',
    summary: string,
    token?: string,
  ): Promise<void> {
    const authToken = token ?? await this.getDefaultToken();
    if (!authToken) return;

    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/check-runs`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${authToken}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          name,
          head_sha: headSha,
          status: 'completed',
          conclusion,
          output: {
            title: name,
            summary,
          },
          completed_at: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      throw new Error(`GitHub API error creating check run: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Add labels to an issue or pull request.
   */
  async addLabels(
    owner: string,
    repo: string,
    issueNumber: number,
    labels: string[],
    token?: string,
  ): Promise<void> {
    const authToken = token ?? await this.getDefaultToken();
    if (!authToken || labels.length === 0) return;

    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${issueNumber}/labels`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${authToken}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ labels }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      throw new Error(`GitHub API error adding labels: ${response.status} ${response.statusText}`);
    }
  }

  // ─── GitHub App Authentication ─────────────────────────────

  /**
   * Generate a JWT for GitHub App authentication (RS256).
   * JWTs are used to obtain installation access tokens.
   */
  private generateJWT(): string {
    const now = Math.floor(Date.now() / 1000);

    const header = {
      alg: 'RS256',
      typ: 'JWT',
    };

    const payload = {
      iat: now - 60, // Issued 60 seconds in the past to account for clock drift
      exp: now + JWT_EXPIRY_SECONDS,
      iss: this.config.appId,
    };

    const encodedHeader = this.base64url(JSON.stringify(header));
    const encodedPayload = this.base64url(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    // Sign with RS256 using the private key
    const sign = createSign('RSA-SHA256');
    sign.update(signingInput);
    sign.end();

    const signature = sign.sign(this.config.privateKey);
    const encodedSignature = this.base64urlFromBuffer(signature);

    return `${signingInput}.${encodedSignature}`;
  }

  /**
   * Get an installation access token, using cache when available.
   */
  async getInstallationToken(installationId: number): Promise<string> {
    // Check cache
    const cached = this.installationTokens.get(installationId);
    if (cached && cached.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      return cached.token;
    }

    // Generate JWT and request new installation token
    const jwt = this.generateJWT();

    const response = await fetch(
      `${GITHUB_API_BASE}/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to get installation token: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { token: string; expires_at: string };
    const expiresAt = new Date(data.expires_at).getTime();

    // Cache the token
    this.installationTokens.set(installationId, {
      token: data.token,
      expiresAt,
    });

    return data.token;
  }

  // ─── Helpers ───────────────────────────────────────────────

  private verifyWebhookSignature(body: string, signature: string): boolean {
    const expected = 'sha256=' + createHmac('sha256', this.config.webhookSecret)
      .update(body)
      .digest('hex');

    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  private async fetchPRDiff(
    owner: string,
    repo: string,
    prNumber: number,
    token?: string,
  ): Promise<string> {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.diff',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    if (token) {
      headers['Authorization'] = `token ${token}`;
    }

    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}`,
      {
        headers,
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch PR diff: ${response.status}`);
    }

    return response.text();
  }

  private extractFilesFromDiff(diff: string): string[] {
    const files: string[] = [];
    const regex = /^diff --git a\/(.+?) b\//gm;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(diff)) !== null) {
      files.push(match[1]);
    }

    return [...new Set(files)];
  }

  private async getDefaultToken(): Promise<string | undefined> {
    // Return the first cached installation token if available
    for (const [installationId] of this.installationTokens) {
      return this.getInstallationToken(installationId);
    }
    return undefined;
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      req.on('error', reject);
    });
  }

  private jsonResponse(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private base64url(str: string): string {
    return Buffer.from(str, 'utf-8')
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  }

  private base64urlFromBuffer(buf: Buffer): string {
    return buf
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  }
}

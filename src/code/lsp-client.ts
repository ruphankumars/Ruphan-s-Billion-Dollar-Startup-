/**
 * LSP Client — JSON-RPC client for Language Server Protocol over stdin/stdout.
 * Provides go-to-definition, references, hover, and diagnostics from language servers.
 */

import { spawn, type ChildProcess } from 'child_process';
import { getLogger } from '../core/logger.js';

const logger = getLogger();

export interface LSPDiagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity?: number; // 1=Error, 2=Warning, 3=Info, 4=Hint
  code?: string | number;
  source?: string;
  message: string;
}

export interface LSPLocation {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface LSPHoverResult {
  contents: string;
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface LSPClientOptions {
  /** Language server command (e.g. 'typescript-language-server') */
  command: string;
  /** Arguments for the language server */
  args?: string[];
  /** Workspace root directory */
  workspaceDir: string;
  /** Timeout for requests in ms (default: 10000) */
  timeout?: number;
}

/**
 * LSPClient communicates with a language server using JSON-RPC 2.0 over stdio.
 * Handles initialization, document sync, and LSP queries.
 */
export class LSPClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private buffer = '';
  private contentLength = -1;
  private initialized = false;
  private diagnosticsMap = new Map<string, LSPDiagnostic[]>();
  private options: Required<LSPClientOptions>;

  constructor(options: LSPClientOptions) {
    this.options = {
      ...options,
      args: options.args ?? [],
      timeout: options.timeout ?? 10000,
    };
  }

  /**
   * Initialize the language server — spawns process, sends initialize request
   */
  async initialize(): Promise<boolean> {
    try {
      this.process = spawn(this.options.command, [...this.options.args, '--stdio'], {
        cwd: this.options.workspaceDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (!this.process.stdout || !this.process.stdin) {
        throw new Error('Failed to establish stdio pipes with language server');
      }

      // Wire up stdout parsing
      this.process.stdout.on('data', (data: Buffer) => {
        this.handleData(data.toString());
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        logger.debug({ server: this.options.command }, `LSP stderr: ${data.toString().trim()}`);
      });

      this.process.on('error', (err) => {
        logger.error({ error: err.message, server: this.options.command }, 'LSP process error');
      });

      this.process.on('exit', (code) => {
        logger.debug({ code, server: this.options.command }, 'LSP process exited');
        this.initialized = false;
      });

      // Send initialize request
      const initResult = await this.sendRequest('initialize', {
        processId: process.pid,
        capabilities: {
          textDocument: {
            synchronization: { dynamicRegistration: false, willSave: false, didSave: true, willSaveWaitUntil: false },
            completion: { completionItem: { snippetSupport: false } },
            hover: { contentFormat: ['plaintext', 'markdown'] },
            definition: { dynamicRegistration: false },
            references: { dynamicRegistration: false },
            publishDiagnostics: { relatedInformation: true },
          },
          workspace: {
            workspaceFolders: true,
          },
        },
        rootUri: `file://${this.options.workspaceDir}`,
        workspaceFolders: [
          { uri: `file://${this.options.workspaceDir}`, name: 'workspace' },
        ],
      }) as Record<string, unknown>;

      // Send initialized notification
      this.sendNotification('initialized', {});
      this.initialized = true;

      logger.debug(
        { server: this.options.command, capabilities: Object.keys(initResult?.capabilities ?? {}) },
        'LSP server initialized',
      );

      return true;
    } catch (err) {
      logger.warn(
        { error: (err as Error).message, server: this.options.command },
        'Failed to initialize LSP server',
      );
      this.cleanup();
      return false;
    }
  }

  /**
   * Open a text document in the language server
   */
  openDocument(filePath: string, content: string, languageId: string): void {
    if (!this.initialized) return;

    this.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri: `file://${filePath}`,
        languageId,
        version: 1,
        text: content,
      },
    });
  }

  /**
   * Get diagnostics for a file (collected from published diagnostics)
   */
  getDiagnostics(filePath: string): LSPDiagnostic[] {
    return this.diagnosticsMap.get(`file://${filePath}`) ?? [];
  }

  /**
   * Get definition location for a symbol at the given position
   */
  async getDefinition(filePath: string, line: number, character: number): Promise<LSPLocation[]> {
    if (!this.initialized) return [];

    try {
      const result = await this.sendRequest('textDocument/definition', {
        textDocument: { uri: `file://${filePath}` },
        position: { line, character },
      });

      if (!result) return [];

      // Normalize to array (can be Location | Location[] | LocationLink[])
      const locations = Array.isArray(result) ? result : [result];
      return locations.map((loc: any) => ({
        uri: loc.uri || loc.targetUri,
        range: loc.range || loc.targetRange,
      })).filter((loc: any) => loc.uri && loc.range);
    } catch {
      return [];
    }
  }

  /**
   * Get references to a symbol at the given position
   */
  async getReferences(filePath: string, line: number, character: number): Promise<LSPLocation[]> {
    if (!this.initialized) return [];

    try {
      const result = await this.sendRequest('textDocument/references', {
        textDocument: { uri: `file://${filePath}` },
        position: { line, character },
        context: { includeDeclaration: true },
      }) as LSPLocation[] | null;

      return result ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Get hover information for a position
   */
  async getHover(filePath: string, line: number, character: number): Promise<LSPHoverResult | null> {
    if (!this.initialized) return null;

    try {
      const result = await this.sendRequest('textDocument/hover', {
        textDocument: { uri: `file://${filePath}` },
        position: { line, character },
      }) as any;

      if (!result) return null;

      // Normalize hover contents
      let contents: string;
      if (typeof result.contents === 'string') {
        contents = result.contents;
      } else if (result.contents?.value) {
        contents = result.contents.value;
      } else if (Array.isArray(result.contents)) {
        contents = result.contents
          .map((c: any) => typeof c === 'string' ? c : c.value)
          .join('\n');
      } else {
        contents = String(result.contents);
      }

      return { contents, range: result.range };
    } catch {
      return null;
    }
  }

  /**
   * Close a document
   */
  closeDocument(filePath: string): void {
    if (!this.initialized) return;

    this.sendNotification('textDocument/didClose', {
      textDocument: { uri: `file://${filePath}` },
    });
  }

  /**
   * Check if the LSP server is running and initialized
   */
  isReady(): boolean {
    return this.initialized && this.process !== null && this.process.exitCode === null;
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    if (!this.initialized || !this.process) {
      this.cleanup();
      return;
    }

    try {
      await this.sendRequest('shutdown', null);
      this.sendNotification('exit', null);
    } catch {
      // If shutdown fails, just kill the process
    }

    this.cleanup();
  }

  // ─── JSON-RPC Protocol ──────────────────────────────────────────────

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error('LSP process stdin not available'));
        return;
      }

      const id = ++this.requestId;
      const message = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      const encoded = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`;

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`LSP request '${method}' timed out after ${this.options.timeout}ms`));
      }, this.options.timeout);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.process.stdin.write(encoded);
    });
  }

  private sendNotification(method: string, params: unknown): void {
    if (!this.process?.stdin?.writable) return;

    const message = JSON.stringify({ jsonrpc: '2.0', method, params });
    const encoded = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`;
    this.process.stdin.write(encoded);
  }

  private handleData(data: string): void {
    this.buffer += data;

    while (true) {
      if (this.contentLength === -1) {
        const headerEnd = this.buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;

        const header = this.buffer.substring(0, headerEnd);
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          this.buffer = this.buffer.substring(headerEnd + 4);
          continue;
        }

        this.contentLength = parseInt(match[1], 10);
        this.buffer = this.buffer.substring(headerEnd + 4);
      }

      if (this.buffer.length < this.contentLength) break;

      const body = this.buffer.substring(0, this.contentLength);
      this.buffer = this.buffer.substring(this.contentLength);
      this.contentLength = -1;

      try {
        const message = JSON.parse(body);
        this.handleMessage(message);
      } catch (err) {
        logger.debug({ error: (err as Error).message }, 'Failed to parse LSP message');
      }
    }
  }

  private handleMessage(message: any): void {
    // Response to a request
    if ('id' in message && message.id !== undefined) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(message.id);

        if (message.error) {
          pending.reject(new Error(`LSP error ${message.error.code}: ${message.error.message}`));
        } else {
          pending.resolve(message.result);
        }
      }
      return;
    }

    // Notification from server
    if (message.method === 'textDocument/publishDiagnostics') {
      const { uri, diagnostics } = message.params;
      this.diagnosticsMap.set(uri, diagnostics);
    }
  }

  private cleanup(): void {
    // Clear pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('LSP client shutting down'));
      this.pendingRequests.delete(id);
    }

    // Kill process
    if (this.process) {
      try {
        this.process.kill('SIGTERM');
      } catch {
        // Already dead
      }
      this.process = null;
    }

    this.initialized = false;
    this.diagnosticsMap.clear();
  }
}

/**
 * Collaboration REST API — HTTP Endpoints for Session Sharing & Teams
 *
 * Provides REST endpoints for session sharing, team management,
 * and artifact access. Designed to be mounted on the dashboard server.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { SharedSessionManager } from './shared-session.js';
import { TeamManager } from './team-manager.js';
import type { AccessLevel, SteeringType } from './types.js';

// ═══════════════════════════════════════════════════════════════
// COLLABORATION API
// ═══════════════════════════════════════════════════════════════

export interface CollaborationAPIDeps {
  sharedSessions: SharedSessionManager;
  teamManager: TeamManager;
}

export function createCollaborationAPIHandler(deps: CollaborationAPIDeps) {
  const { sharedSessions, teamManager } = deps;

  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const method = req.method ?? 'GET';
    const path = url.pathname;

    // ─── Session Sharing ──────────────────────────────────────

    // POST /api/sessions/:id/share
    const shareMatch = path.match(/^\/api\/sessions\/([^/]+)\/share$/);
    if (shareMatch && method === 'POST') {
      const sessionId = shareMatch[1];
      const body = await readBody(req);
      const memberId = body.memberId ?? teamManager.getCurrentMember()?.id ?? 'anonymous';

      const shared = sharedSessions.share({
        sessionId,
        createdBy: memberId,
        accessLevel: body.accessLevel as AccessLevel,
        expiresIn: body.expiresIn,
        steeringEnabled: body.steeringEnabled,
      });

      sendJSON(res, 200, {
        shareToken: shared.shareToken,
        shareUrl: shared.shareUrl,
        accessLevel: shared.accessLevel,
        steeringEnabled: shared.steeringEnabled,
      });
      return true;
    }

    // GET /api/sessions/shared/:token
    const sharedMatch = path.match(/^\/api\/sessions\/shared\/([^/]+)$/);
    if (sharedMatch && method === 'GET') {
      const token = sharedMatch[1];
      const shared = sharedSessions.getByToken(token);
      if (!shared) {
        sendJSON(res, 404, { error: 'Shared session not found or expired' });
        return true;
      }
      sendJSON(res, 200, shared);
      return true;
    }

    // POST /api/sessions/shared/:token/join
    const joinMatch = path.match(/^\/api\/sessions\/shared\/([^/]+)\/join$/);
    if (joinMatch && method === 'POST') {
      const token = joinMatch[1];
      const body = await readBody(req);
      const member = teamManager.getCurrentMember();

      const shared = sharedSessions.join(token, {
        id: member?.id ?? body.memberId ?? 'anonymous',
        name: member?.name ?? body.name ?? 'Anonymous',
      });

      if (!shared) {
        sendJSON(res, 404, { error: 'Session not found or expired' });
        return true;
      }

      sendJSON(res, 200, { sessionId: shared.sessionId, viewers: shared.viewers });
      return true;
    }

    // POST /api/sessions/shared/:token/steer
    const steerMatch = path.match(/^\/api\/sessions\/shared\/([^/]+)\/steer$/);
    if (steerMatch && method === 'POST') {
      const token = steerMatch[1];
      const shared = sharedSessions.getByToken(token);
      if (!shared) {
        sendJSON(res, 404, { error: 'Session not found' });
        return true;
      }

      const body = await readBody(req);
      const member = teamManager.getCurrentMember();

      const command = sharedSessions.steer({
        sessionId: shared.sessionId,
        memberId: member?.id ?? body.memberId ?? 'anonymous',
        type: (body.type as SteeringType) ?? 'message',
        content: body.content ?? '',
      });

      if (!command) {
        sendJSON(res, 403, { error: 'Steering not enabled for this session' });
        return true;
      }

      sendJSON(res, 200, command);
      return true;
    }

    // DELETE /api/sessions/:id/share
    const revokeMatch = path.match(/^\/api\/sessions\/([^/]+)\/share$/);
    if (revokeMatch && method === 'DELETE') {
      const sessionId = revokeMatch[1];
      const revoked = sharedSessions.revoke(sessionId);
      sendJSON(res, 200, { revoked });
      return true;
    }

    // GET /api/sessions/:id/artifacts
    const artifactsMatch = path.match(/^\/api\/sessions\/([^/]+)\/artifacts$/);
    if (artifactsMatch && method === 'GET') {
      const sessionId = artifactsMatch[1];
      const type = url.searchParams.get('type') ?? undefined;
      const artifacts = sharedSessions.getArtifacts(sessionId, type as any);
      sendJSON(res, 200, { artifacts });
      return true;
    }

    // ─── Team Management ──────────────────────────────────────

    // GET /api/team/status
    if (path === '/api/team/status' && method === 'GET') {
      const team = teamManager.getTeam();
      if (!team) {
        sendJSON(res, 404, { error: 'No team configured' });
        return true;
      }

      const currentMember = teamManager.getCurrentMember();
      sendJSON(res, 200, {
        team: { id: team.id, name: team.name, memberCount: team.members.length },
        currentMember: currentMember ? { id: currentMember.id, name: currentMember.name, role: currentMember.role } : null,
        sharedSessions: sharedSessions.getStats(),
      });
      return true;
    }

    // GET /api/team/members
    if (path === '/api/team/members' && method === 'GET') {
      const members = teamManager.listMembers();
      sendJSON(res, 200, {
        members: members.map((m) => ({
          id: m.id,
          name: m.name,
          email: m.email,
          role: m.role,
          lastActiveAt: m.lastActiveAt,
        })),
      });
      return true;
    }

    // POST /api/team/members
    if (path === '/api/team/members' && method === 'POST') {
      const body = await readBody(req);
      try {
        const member = teamManager.addMember({
          name: body.name,
          email: body.email,
          role: body.role,
        });
        sendJSON(res, 201, member);
      } catch (err) {
        sendJSON(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    // GET /api/team/sessions
    if (path === '/api/team/sessions' && method === 'GET') {
      const shared = sharedSessions.listShared();
      sendJSON(res, 200, {
        sessions: shared.map((s) => ({
          sessionId: s.sessionId,
          shareUrl: s.shareUrl,
          createdBy: s.createdBy,
          createdAt: s.createdAt,
          accessLevel: s.accessLevel,
          viewerCount: s.viewers.filter((v) => v.isActive).length,
          artifactCount: s.artifacts.length,
        })),
      });
      return true;
    }

    return false;
  };
}

// ─── Helpers ──────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function sendJSON(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

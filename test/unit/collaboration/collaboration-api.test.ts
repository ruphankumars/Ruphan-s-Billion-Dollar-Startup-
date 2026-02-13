import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { createCollaborationAPIHandler } from '../../../src/collaboration/collaboration-api.js';
import { SharedSessionManager } from '../../../src/collaboration/shared-session.js';
import { TeamManager } from '../../../src/collaboration/team-manager.js';

// Mock node:child_process for TeamManager git identity
const { mockExecFileSync } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

function createMockReq(
  method: string,
  url: string,
  body?: Record<string, any>
): any {
  const req = new EventEmitter() as any;
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost:3000' };

  // Simulate body emission after creation
  if (body) {
    process.nextTick(() => {
      req.emit('data', Buffer.from(JSON.stringify(body)));
      req.emit('end');
    });
  } else {
    process.nextTick(() => {
      req.emit('end');
    });
  }

  return req;
}

function createMockRes(): any {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    writeHead: vi.fn((status: number, headers?: Record<string, string>) => {
      res.statusCode = status;
      if (headers) {
        res.headers = { ...res.headers, ...headers };
      }
      return res;
    }),
    end: vi.fn((data?: string) => {
      if (data) {
        res.body = data;
      }
      return res;
    }),
  };
  return res;
}

function parseResBody(res: any): any {
  try {
    return JSON.parse(res.body);
  } catch {
    return res.body;
  }
}

describe('createCollaborationAPIHandler', () => {
  let handler: ReturnType<typeof createCollaborationAPIHandler>;
  let sharedSessions: SharedSessionManager;
  let teamManager: TeamManager;

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock git identity for TeamManager
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('user.name')) return 'Alice\n';
      if (args.includes('user.email')) return 'alice@example.com\n';
      throw new Error('unknown');
    });

    sharedSessions = new SharedSessionManager();
    teamManager = new TeamManager();
    // initTeam(name: string) — uses git identity internally
    teamManager.initTeam('TestTeam');

    // createCollaborationAPIHandler({sharedSessions, teamManager})
    handler = createCollaborationAPIHandler({
      sharedSessions,
      teamManager,
    });
  });

  async function handleRequest(
    method: string,
    url: string,
    body?: Record<string, any>
  ): Promise<any> {
    const req = createMockReq(method, url, body);
    const res = createMockRes();

    await handler(req, res);

    return res;
  }

  describe('POST /api/sessions/:id/share', () => {
    it('creates shared session', async () => {
      const res = await handleRequest('POST', '/api/sessions/sess-1/share', {});

      expect(res.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({ 'Content-Type': 'application/json' })
      );

      const body = parseResBody(res);
      // The API returns { shareToken, shareUrl, accessLevel, steeringEnabled }
      expect(body.shareToken).toBeDefined();
      expect(body.shareUrl).toBeDefined();
    });
  });

  describe('GET /api/sessions/shared/:token', () => {
    it('returns shared session', async () => {
      const shared = sharedSessions.share({
        sessionId: 'sess-1',
        createdBy: 'user-1',
      });

      const res = await handleRequest(
        'GET',
        `/api/sessions/shared/${shared.shareToken}`
      );

      expect(res.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({ 'Content-Type': 'application/json' })
      );

      const body = parseResBody(res);
      expect(body.sessionId).toBe('sess-1');
    });

    it('returns 404 for invalid token', async () => {
      const res = await handleRequest(
        'GET',
        '/api/sessions/shared/nonexistent-token'
      );

      expect(res.writeHead).toHaveBeenCalledWith(
        404,
        expect.any(Object)
      );
    });
  });

  describe('POST /api/sessions/shared/:token/join', () => {
    it('joins session', async () => {
      const shared = sharedSessions.share({
        sessionId: 'sess-1',
        createdBy: 'user-1',
      });

      const res = await handleRequest(
        'POST',
        `/api/sessions/shared/${shared.shareToken}/join`,
        {
          memberId: 'user-2',
          name: 'Bob',
        }
      );

      expect(res.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({ 'Content-Type': 'application/json' })
      );

      const body = parseResBody(res);
      // API returns { sessionId, viewers }
      expect(body.sessionId).toBe('sess-1');
      expect(body.viewers).toBeDefined();
    });
  });

  describe('POST /api/sessions/shared/:token/steer', () => {
    it('sends steering command', async () => {
      const shared = sharedSessions.share({
        sessionId: 'sess-1',
        createdBy: 'user-1',
        steeringEnabled: true,
      });

      const res = await handleRequest(
        'POST',
        `/api/sessions/shared/${shared.shareToken}/steer`,
        {
          memberId: 'user-2',
          type: 'message',
          content: 'Focus on tests',
        }
      );

      expect(res.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({ 'Content-Type': 'application/json' })
      );

      const body = parseResBody(res);
      expect(body.type).toBe('message');
      expect(body.content).toBe('Focus on tests');
    });
  });

  describe('DELETE /api/sessions/:id/share', () => {
    it('revokes share', async () => {
      const shared = sharedSessions.share({
        sessionId: 'sess-1',
        createdBy: 'user-1',
      });

      const res = await handleRequest('DELETE', '/api/sessions/sess-1/share');

      expect(res.writeHead).toHaveBeenCalledWith(
        200,
        expect.any(Object)
      );

      const afterRevoke = sharedSessions.getByToken(shared.shareToken);
      expect(afterRevoke).toBeUndefined();
    });
  });

  describe('GET /api/team/status', () => {
    it('returns team info', async () => {
      const res = await handleRequest('GET', '/api/team/status');

      expect(res.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({ 'Content-Type': 'application/json' })
      );

      const body = parseResBody(res);
      // API returns { team: {id, name, memberCount}, currentMember, sharedSessions }
      expect(body.team).toBeDefined();
      expect(body.team.name).toBe('TestTeam');
    });
  });

  describe('GET /api/team/members', () => {
    it('returns member list', async () => {
      teamManager.addMember({ name: 'Bob', email: 'bob@example.com' });

      const res = await handleRequest('GET', '/api/team/members');

      expect(res.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({ 'Content-Type': 'application/json' })
      );

      const body = parseResBody(res);
      // API returns { members: [...] }
      expect(body.members).toBeDefined();
      expect(Array.isArray(body.members)).toBe(true);
      expect(body.members).toHaveLength(2); // Alice + Bob
      expect(body.members.map((m: any) => m.name)).toContain('Alice');
      expect(body.members.map((m: any) => m.name)).toContain('Bob');
    });
  });

  describe('GET /api/team/sessions', () => {
    it('returns shared sessions', async () => {
      sharedSessions.share({
        sessionId: 'sess-1',
        createdBy: 'user-1',
      });

      sharedSessions.share({
        sessionId: 'sess-2',
        createdBy: 'user-1',
      });

      const res = await handleRequest('GET', '/api/team/sessions');

      expect(res.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({ 'Content-Type': 'application/json' })
      );

      const body = parseResBody(res);
      // API returns { sessions: [...] }
      expect(body.sessions).toBeDefined();
      expect(Array.isArray(body.sessions)).toBe(true);
      expect(body.sessions).toHaveLength(2);
    });
  });
});

/**
 * Team Manager — Team Configuration & Identity
 *
 * Loads team config from YAML files, resolves user identity
 * from git config, manages team and personal secrets.
 * Uses crypto for secret encryption — zero npm dependencies.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type {
  TeamConfig,
  TeamMember,
  TeamRole,
  AccessLevel,
  AccessPermission,
  ACCESS_PERMISSIONS,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// TEAM MANAGER
// ═══════════════════════════════════════════════════════════════

export class TeamManager {
  private team: TeamConfig | null = null;
  private configPath: string;
  private encryptionKey: string;
  private currentMemberId: string | null = null;

  constructor(options?: { configPath?: string; encryptionKey?: string }) {
    this.configPath = options?.configPath ?? join(
      process.env.HOME ?? process.env.USERPROFILE ?? '.',
      '.cortexos',
      'team.yaml',
    );
    this.encryptionKey = options?.encryptionKey ?? 'cortexos-team-default-key';
  }

  /** Initialize a new team */
  initTeam(name: string): TeamConfig {
    const identity = this.resolveGitIdentity();

    const team: TeamConfig = {
      id: `team_${randomUUID().slice(0, 8)}`,
      name,
      members: identity ? [{
        id: `member_${randomUUID().slice(0, 8)}`,
        name: identity.name,
        email: identity.email,
        role: 'admin',
        gitIdentity: identity.email,
        joinedAt: Date.now(),
      }] : [],
      secrets: { team: {}, personal: {} },
      settings: {
        defaultAccessLevel: 'viewer',
        autoShare: false,
        shareBaseUrl: 'http://localhost:3100/shared',
        requireApproval: false,
        allowSteering: true,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.team = team;
    if (identity) this.currentMemberId = team.members[0].id;
    return team;
  }

  /** Load team config from YAML file */
  load(path?: string): TeamConfig | null {
    const filePath = path ?? this.configPath;
    if (!existsSync(filePath)) return null;

    try {
      const content = readFileSync(filePath, 'utf-8');
      this.team = this.parseTeamYaml(content);
      this.identifyCurrentMember();
      return this.team;
    } catch {
      return null;
    }
  }

  /** Save team config to YAML file */
  save(path?: string): void {
    if (!this.team) throw new Error('No team to save');
    const filePath = path ?? this.configPath;
    const dir = filePath.replace(/[/\\][^/\\]+$/, '');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, this.serializeTeamYaml(this.team), 'utf-8');
  }

  /** Get the current team */
  getTeam(): TeamConfig | null {
    return this.team;
  }

  /** Get the current user's member record */
  getCurrentMember(): TeamMember | null {
    if (!this.team || !this.currentMemberId) return null;
    return this.team.members.find((m) => m.id === this.currentMemberId) ?? null;
  }

  /** Add a team member */
  addMember(options: {
    name: string;
    email: string;
    role?: TeamRole;
  }): TeamMember {
    if (!this.team) throw new Error('No team initialized');

    // Check if email already exists
    if (this.team.members.some((m) => m.email === options.email)) {
      throw new Error(`Member with email "${options.email}" already exists`);
    }

    const member: TeamMember = {
      id: `member_${randomUUID().slice(0, 8)}`,
      name: options.name,
      email: options.email,
      role: options.role ?? 'operator',
      gitIdentity: options.email,
      joinedAt: Date.now(),
    };

    this.team.members.push(member);
    this.team.updatedAt = Date.now();
    return member;
  }

  /** Remove a team member */
  removeMember(memberId: string): boolean {
    if (!this.team) return false;
    const idx = this.team.members.findIndex((m) => m.id === memberId);
    if (idx === -1) return false;
    this.team.members.splice(idx, 1);
    this.team.updatedAt = Date.now();
    return true;
  }

  /** Update a member's role */
  setMemberRole(memberId: string, role: TeamRole): void {
    if (!this.team) throw new Error('No team initialized');
    const member = this.team.members.find((m) => m.id === memberId);
    if (!member) throw new Error(`Member "${memberId}" not found`);
    member.role = role;
    this.team.updatedAt = Date.now();
  }

  /** Get a member by ID */
  getMember(memberId: string): TeamMember | undefined {
    return this.team?.members.find((m) => m.id === memberId);
  }

  /** Get a member by email */
  getMemberByEmail(email: string): TeamMember | undefined {
    return this.team?.members.find((m) => m.email === email);
  }

  /** List all members */
  listMembers(): TeamMember[] {
    return this.team?.members ?? [];
  }

  /** Check if a member has permission */
  hasPermission(memberId: string, action: keyof AccessPermission): boolean {
    if (!this.team) return false;
    const member = this.team.members.find((m) => m.id === memberId);
    if (!member) return false;
    // Import would create circular dep, so inline
    const perms: Record<string, AccessPermission> = {
      viewer: { canView: true, canSteer: false, canCancel: false, canExport: true, canAdmin: false },
      operator: { canView: true, canSteer: true, canCancel: true, canExport: true, canAdmin: false },
      admin: { canView: true, canSteer: true, canCancel: true, canExport: true, canAdmin: true },
    };
    return perms[member.role]?.[action] ?? false;
  }

  // ─── Secrets ──────────────────────────────────────────────

  /** Set a team secret (encrypted) */
  setTeamSecret(key: string, value: string): void {
    if (!this.team?.secrets) throw new Error('No team initialized');
    this.team.secrets.team[key] = this.encrypt(value);
    this.team.updatedAt = Date.now();
  }

  /** Get a team secret (decrypted) */
  getTeamSecret(key: string): string | undefined {
    const encrypted = this.team?.secrets?.team[key];
    if (!encrypted) return undefined;
    return this.decrypt(encrypted);
  }

  /** Set a personal secret (encrypted, per member) */
  setPersonalSecret(memberId: string, key: string, value: string): void {
    if (!this.team?.secrets) throw new Error('No team initialized');
    const compositeKey = `${memberId}:${key}`;
    this.team.secrets.personal[compositeKey] = this.encrypt(value);
    this.team.updatedAt = Date.now();
  }

  /** Get a personal secret (decrypted) */
  getPersonalSecret(memberId: string, key: string): string | undefined {
    const compositeKey = `${memberId}:${key}`;
    const encrypted = this.team?.secrets?.personal[compositeKey];
    if (!encrypted) return undefined;
    return this.decrypt(encrypted);
  }

  /** List secret keys (without values) */
  listSecretKeys(): { team: string[]; personal: string[] } {
    return {
      team: Object.keys(this.team?.secrets?.team ?? {}),
      personal: Object.keys(this.team?.secrets?.personal ?? {}),
    };
  }

  // ─── Git Identity ─────────────────────────────────────────

  /** Resolve the current user's git identity */
  resolveGitIdentity(): { name: string; email: string } | null {
    try {
      const name = execFileSync('git', ['config', 'user.name'], { encoding: 'utf-8' }).trim();
      const email = execFileSync('git', ['config', 'user.email'], { encoding: 'utf-8' }).trim();
      if (name && email) return { name, email };
      return null;
    } catch {
      return null;
    }
  }

  // ─── Internal ─────────────────────────────────────────────

  private identifyCurrentMember(): void {
    const identity = this.resolveGitIdentity();
    if (!identity || !this.team) return;
    const member = this.team.members.find(
      (m) => m.gitIdentity === identity.email || m.email === identity.email,
    );
    if (member) {
      this.currentMemberId = member.id;
      member.lastActiveAt = Date.now();
    }
  }

  private encrypt(plaintext: string): string {
    const key = scryptSync(this.encryptionKey, 'cortexos-salt', 32);
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(plaintext, 'utf-8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  private decrypt(ciphertext: string): string {
    const [ivHex, encrypted] = ciphertext.split(':');
    if (!ivHex || !encrypted) return ciphertext;
    const key = scryptSync(this.encryptionKey, 'cortexos-salt', 32);
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');
    return decrypted;
  }

  private parseTeamYaml(content: string): TeamConfig {
    const lines = content.split('\n');
    const team: Partial<TeamConfig> = {
      members: [],
      secrets: { team: {}, personal: {} },
    };
    let section = '';
    let currentMember: Partial<TeamMember> | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const indent = line.search(/\S/);

      if (indent === 0) {
        if (currentMember && team.members) {
          team.members.push(currentMember as TeamMember);
          currentMember = null;
        }
        const [key, ...valParts] = trimmed.split(':');
        const val = valParts.join(':').trim();
        section = key.trim();

        if (section === 'id') team.id = val;
        else if (section === 'name') team.name = val;
      } else if (trimmed.startsWith('- ') && section === 'members') {
        if (currentMember) {
          team.members!.push(currentMember as TeamMember);
        }
        currentMember = {};
        const [key, ...valParts] = trimmed.replace(/^-\s*/, '').split(':');
        const val = valParts.join(':').trim();
        if (key.trim() === 'name') currentMember.name = val;
      } else if (currentMember && indent > 2) {
        const [key, ...valParts] = trimmed.split(':');
        const val = valParts.join(':').trim();
        const k = key.trim();
        if (k === 'id') currentMember.id = val;
        else if (k === 'name') currentMember.name = val;
        else if (k === 'email') currentMember.email = val;
        else if (k === 'role') currentMember.role = val as TeamRole;
        else if (k === 'gitIdentity') currentMember.gitIdentity = val;
      }
    }

    if (currentMember && team.members) {
      team.members.push(currentMember as TeamMember);
    }

    if (!team.id) team.id = `team_${randomUUID().slice(0, 8)}`;
    if (!team.name) team.name = 'My Team';
    team.createdAt = team.createdAt ?? Date.now();
    team.updatedAt = team.updatedAt ?? Date.now();

    return team as TeamConfig;
  }

  private serializeTeamYaml(team: TeamConfig): string {
    const lines: string[] = [];
    lines.push(`id: ${team.id}`);
    lines.push(`name: ${team.name}`);
    lines.push('');
    lines.push('members:');
    for (const m of team.members) {
      lines.push(`  - name: ${m.name}`);
      lines.push(`    id: ${m.id}`);
      lines.push(`    email: ${m.email}`);
      lines.push(`    role: ${m.role}`);
      if (m.gitIdentity) lines.push(`    gitIdentity: ${m.gitIdentity}`);
      lines.push('');
    }

    if (team.settings) {
      lines.push('settings:');
      lines.push(`  defaultAccessLevel: ${team.settings.defaultAccessLevel}`);
      lines.push(`  autoShare: ${team.settings.autoShare}`);
      lines.push(`  shareBaseUrl: ${team.settings.shareBaseUrl}`);
      lines.push(`  requireApproval: ${team.settings.requireApproval}`);
      lines.push(`  allowSteering: ${team.settings.allowSteering}`);
    }

    return lines.join('\n') + '\n';
  }
}

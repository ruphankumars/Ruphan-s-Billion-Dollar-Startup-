/**
 * Team Collaboration — Types
 *
 * Session sharing, team management, artifacts, access control.
 * Matches Oz's team collaboration model as an embeddable SDK component.
 */

// ═══════════════════════════════════════════════════════════════
// TEAM
// ═══════════════════════════════════════════════════════════════

export interface TeamConfig {
  id: string;
  name: string;
  members: TeamMember[];
  secrets?: TeamSecrets;
  settings?: TeamSettings;
  createdAt: number;
  updatedAt: number;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  gitIdentity?: string;       // git user.email for auto-identification
  joinedAt: number;
  lastActiveAt?: number;
}

export type TeamRole = 'admin' | 'operator' | 'viewer';

export interface TeamSecrets {
  team: Record<string, string>;     // Shared across team
  personal: Record<string, string>; // Per-member secrets
}

export interface TeamSettings {
  defaultAccessLevel: AccessLevel;
  autoShare: boolean;
  shareBaseUrl: string;
  requireApproval: boolean;
  allowSteering: boolean;
}

// ═══════════════════════════════════════════════════════════════
// ACCESS CONTROL
// ═══════════════════════════════════════════════════════════════

export type AccessLevel = 'viewer' | 'operator' | 'admin';

export interface AccessPermission {
  canView: boolean;
  canSteer: boolean;
  canCancel: boolean;
  canExport: boolean;
  canAdmin: boolean;
}

export const ACCESS_PERMISSIONS: Record<AccessLevel, AccessPermission> = {
  viewer: { canView: true, canSteer: false, canCancel: false, canExport: true, canAdmin: false },
  operator: { canView: true, canSteer: true, canCancel: true, canExport: true, canAdmin: false },
  admin: { canView: true, canSteer: true, canCancel: true, canExport: true, canAdmin: true },
};

// ═══════════════════════════════════════════════════════════════
// SHARED SESSIONS
// ═══════════════════════════════════════════════════════════════

export interface SharedSession {
  sessionId: string;
  shareToken: string;
  shareUrl: string;
  createdBy: string;           // Team member ID
  createdAt: number;
  expiresAt?: number;
  accessLevel: AccessLevel;
  viewers: SessionViewer[];
  artifacts: SessionArtifact[];
  steeringEnabled: boolean;
}

export interface SessionViewer {
  memberId: string;
  name: string;
  joinedAt: number;
  lastSeenAt: number;
  isActive: boolean;
}

export interface SessionArtifact {
  id: string;
  type: ArtifactType;
  name: string;
  url?: string;
  data?: Record<string, unknown>;
  createdAt: number;
}

export type ArtifactType =
  | 'pull-request'
  | 'branch'
  | 'commit'
  | 'plan'
  | 'report'
  | 'diff'
  | 'file';

// ═══════════════════════════════════════════════════════════════
// STEERING
// ═══════════════════════════════════════════════════════════════

export interface SteeringCommand {
  id: string;
  sessionId: string;
  memberId: string;
  type: SteeringType;
  content: string;
  createdAt: number;
  acknowledged: boolean;
}

export type SteeringType =
  | 'message'     // Send a message/instruction
  | 'approve'     // Approve a pending action
  | 'reject'      // Reject a pending action
  | 'cancel'      // Cancel execution
  | 'redirect';   // Change task direction

// ═══════════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════════

export type CollaborationEventType =
  | 'session:shared'
  | 'session:joined'
  | 'session:left'
  | 'session:steered'
  | 'artifact:created'
  | 'team:member:joined'
  | 'team:member:left'
  | 'team:settings:updated';

export interface CollaborationEvent {
  type: CollaborationEventType;
  sessionId?: string;
  memberId?: string;
  timestamp: number;
  data?: unknown;
}

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

export interface CollaborationConfig {
  enabled: boolean;
  autoShare: boolean;
  shareBaseUrl: string;
  accessDefault: AccessLevel;
  teamConfigPath?: string;     // Path to team.yaml
  shareExpiry?: number;        // Default share link expiry in ms
}

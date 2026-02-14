/**
 * Workforce Types — CortexOS Agent Workforce Planner
 *
 * Type definitions for human-agent workforce entities, availability windows,
 * task assignments, skill gap analysis, and capacity forecasting.
 */

// ═══════════════════════════════════════════════════════════════
// AVAILABILITY
// ═══════════════════════════════════════════════════════════════

export interface AvailabilityWindow {
  dayOfWeek: number;
  startHour: number;
  endHour: number;
}

// ═══════════════════════════════════════════════════════════════
// WORKFORCE ENTITIES
// ═══════════════════════════════════════════════════════════════

export interface WorkforceEntity {
  id: string;
  type: 'human' | 'agent';
  name: string;
  skills: string[];
  capacity: number;
  currentLoad: number;
  costPerHour: number;
  availability: AvailabilityWindow[];
  performance: number;
}

// ═══════════════════════════════════════════════════════════════
// PLANS
// ═══════════════════════════════════════════════════════════════

export interface WorkforcePlan {
  id: string;
  name: string;
  period: { start: number; end: number };
  entities: WorkforceEntity[];
  assignments: TaskAssignment[];
  totalCost: number;
  totalCapacity: number;
  utilizationRate: number;
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════
// TASK ASSIGNMENTS
// ═══════════════════════════════════════════════════════════════

export interface TaskAssignment {
  id: string;
  taskId: string;
  entityId: string;
  estimatedHours: number;
  estimatedCost: number;
  priority: number;
  status: 'planned' | 'active' | 'completed';
}

// ═══════════════════════════════════════════════════════════════
// ANALYTICS
// ═══════════════════════════════════════════════════════════════

export interface SkillGap {
  skill: string;
  required: number;
  available: number;
  gap: number;
  recommendation: string;
}

export interface CapacityForecast {
  period: string;
  totalDemand: number;
  totalCapacity: number;
  surplus: number;
  bottlenecks: string[];
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export interface WorkforceConfig {
  enabled: boolean;
  maxEntities: number;
  planningHorizonDays: number;
  utilizationTarget: number;
}

// ═══════════════════════════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════════════════════════

export interface WorkforceStats {
  totalEntities: number;
  totalHumans: number;
  totalAgents: number;
  totalAssignments: number;
  avgUtilization: number;
  totalCost: number;
}

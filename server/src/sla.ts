// SLA policy and calculations — pure functions, no I/O, heavily unit-tested.
//
// Each priority has a target resolution time. From a ticket's creation time we
// derive its SLA due date, and at any moment we can classify it as on-track,
// at-risk (inside the final quarter of its window), or breached.

export type Priority = 'urgent' | 'high' | 'normal' | 'low';

/** Target resolution time per priority, in minutes. */
export const SLA_RESOLUTION_MINUTES: Record<Priority, number> = {
  urgent: 4 * 60, //  4 hours
  high: 8 * 60, //  8 hours (one business day)
  normal: 24 * 60, //  1 day
  low: 72 * 60, //  3 days
};

/** Fraction of the SLA window remaining below which a ticket is "at risk". */
export const AT_RISK_THRESHOLD = 0.25;

export type SlaState = 'ok' | 'at_risk' | 'breached' | 'met';

export interface SlaStatus {
  state: SlaState;
  dueAt: string; // ISO timestamp
  minutesRemaining: number; // negative once breached
}

/** ISO timestamp of the SLA deadline for a ticket created at `createdAt`. */
export function computeSlaDueAt(priority: Priority, createdAt: Date | string): string {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) {
    throw new Error(`Invalid createdAt: ${String(createdAt)}`);
  }
  const minutes = SLA_RESOLUTION_MINUTES[priority];
  if (minutes === undefined) {
    throw new Error(`Unknown priority: ${String(priority)}`);
  }
  return new Date(created.getTime() + minutes * 60_000).toISOString();
}

/**
 * Classify a ticket's SLA position.
 * - Resolved tickets are `met` if resolved before the deadline, else `breached`.
 * - Open tickets are `breached` past the deadline, `at_risk` inside the final
 *   quarter of the window, otherwise `ok`.
 */
export function getSlaStatus(params: {
  priority: Priority;
  createdAt: Date | string;
  resolvedAt?: Date | string | null;
  now?: Date | string;
}): SlaStatus {
  const { priority, createdAt } = params;
  const now = new Date(params.now ?? Date.now());
  const dueAt = computeSlaDueAt(priority, createdAt);
  const dueMs = new Date(dueAt).getTime();

  if (params.resolvedAt) {
    const resolvedMs = new Date(params.resolvedAt).getTime();
    return {
      state: resolvedMs <= dueMs ? 'met' : 'breached',
      dueAt,
      minutesRemaining: Math.round((dueMs - resolvedMs) / 60_000),
    };
  }

  const minutesRemaining = Math.round((dueMs - now.getTime()) / 60_000);
  if (minutesRemaining < 0) {
    return { state: 'breached', dueAt, minutesRemaining };
  }

  const windowMinutes = SLA_RESOLUTION_MINUTES[priority];
  const fractionRemaining = minutesRemaining / windowMinutes;
  return {
    state: fractionRemaining <= AT_RISK_THRESHOLD ? 'at_risk' : 'ok',
    dueAt,
    minutesRemaining,
  };
}

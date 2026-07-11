// Ticket domain logic — status state machine, validation, and stats.
// Pure functions only, so the rules are exhaustively unit-testable.

import type { Priority } from './sla.js';

export const STATUSES = ['open', 'in_progress', 'on_hold', 'resolved', 'closed'] as const;
export type Status = (typeof STATUSES)[number];

export const PRIORITIES: Priority[] = ['urgent', 'high', 'normal', 'low'];

export const CATEGORIES = [
  'hardware',
  'software',
  'network',
  'account_access',
  'email',
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * Allowed status transitions. A ticket can always stay put (no-op handled by
 * callers). Closed is terminal; resolved can be reopened or closed.
 */
const TRANSITIONS: Record<Status, Status[]> = {
  open: ['in_progress', 'on_hold', 'resolved', 'closed'],
  in_progress: ['on_hold', 'resolved', 'closed'],
  on_hold: ['in_progress', 'resolved', 'closed'],
  resolved: ['closed', 'in_progress'], // reopen -> in_progress
  closed: [], // terminal
};

export function isValidStatus(value: unknown): value is Status {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

export function isValidPriority(value: unknown): value is Priority {
  return typeof value === 'string' && PRIORITIES.includes(value as Priority);
}

export function isValidCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

export function canTransition(from: Status, to: Status): boolean {
  if (from === to) return true;
  return (TRANSITIONS[from] ?? []).includes(to);
}

/** The set of statuses a ticket in `from` may move to (excluding itself). */
export function allowedTransitions(from: Status): Status[] {
  return TRANSITIONS[from] ?? [];
}

/**
 * Validate and describe the effect of a status change. Throws on an illegal
 * transition. Returns whether the change marks the ticket resolved (so the
 * caller can stamp resolved_at) or reopened (so it can clear it).
 */
export function transitionStatus(
  from: Status,
  to: Status,
): { resolved: boolean; reopened: boolean } {
  if (!isValidStatus(to)) {
    throw new Error(`Invalid target status: ${String(to)}`);
  }
  if (!canTransition(from, to)) {
    throw new Error(`Illegal transition: ${from} -> ${to}`);
  }
  const becameResolved = to === 'resolved' && from !== 'resolved';
  const wasResolved = from === 'resolved' || from === 'closed';
  const nowOpen = to === 'in_progress';
  return {
    resolved: becameResolved,
    reopened: wasResolved && nowOpen,
  };
}

const OPEN_STATUSES: Status[] = ['open', 'in_progress', 'on_hold'];

export function isOpenStatus(status: Status): boolean {
  return OPEN_STATUSES.includes(status);
}

export interface TicketLike {
  status: Status;
  priority: Priority;
  assignee_id: number | null;
}

export interface TicketStats {
  total: number;
  open: number;
  unassigned: number;
  byStatus: Record<Status, number>;
  byPriority: Record<Priority, number>;
}

/** Aggregate counts for a dashboard. */
export function computeStats(tickets: TicketLike[]): TicketStats {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
  const byPriority = Object.fromEntries(PRIORITIES.map((p) => [p, 0])) as Record<Priority, number>;

  let open = 0;
  let unassigned = 0;
  for (const t of tickets) {
    byStatus[t.status] += 1;
    byPriority[t.priority] += 1;
    if (isOpenStatus(t.status)) {
      open += 1;
      if (t.assignee_id === null) unassigned += 1;
    }
  }

  return { total: tickets.length, open, unassigned, byStatus, byPriority };
}

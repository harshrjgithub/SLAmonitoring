import { describe, it, expect } from 'vitest';
import {
  canTransition,
  transitionStatus,
  allowedTransitions,
  computeStats,
  isValidStatus,
  isValidPriority,
  isValidCategory,
  type TicketLike,
} from '../src/tickets.js';

describe('status state machine', () => {
  it('allows sensible forward transitions', () => {
    expect(canTransition('open', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'resolved')).toBe(true);
    expect(canTransition('resolved', 'closed')).toBe(true);
  });

  it('allows reopening a resolved ticket but not a closed one', () => {
    expect(canTransition('resolved', 'in_progress')).toBe(true);
    expect(canTransition('closed', 'in_progress')).toBe(false);
    expect(allowedTransitions('closed')).toEqual([]);
  });

  it('rejects illegal jumps', () => {
    expect(canTransition('open', 'closed')).toBe(true); // allowed: cancel a ticket
    expect(canTransition('closed', 'open')).toBe(false);
    expect(() => transitionStatus('closed', 'open')).toThrow(/Illegal transition/);
  });

  it('treats a no-op transition as valid', () => {
    expect(canTransition('open', 'open')).toBe(true);
  });

  it('flags when a ticket becomes resolved', () => {
    expect(transitionStatus('in_progress', 'resolved')).toEqual({ resolved: true, reopened: false });
  });

  it('flags when a resolved ticket is reopened', () => {
    expect(transitionStatus('resolved', 'in_progress')).toEqual({ resolved: false, reopened: true });
  });

  it('throws on an unknown target status', () => {
    // @ts-expect-error invalid on purpose
    expect(() => transitionStatus('open', 'banana')).toThrow(/Invalid target status/);
  });
});

describe('validators', () => {
  it('validate status/priority/category', () => {
    expect(isValidStatus('open')).toBe(true);
    expect(isValidStatus('nope')).toBe(false);
    expect(isValidPriority('urgent')).toBe(true);
    expect(isValidPriority('someday')).toBe(false);
    expect(isValidCategory('network')).toBe(true);
    expect(isValidCategory('teleport')).toBe(false);
  });
});

describe('computeStats', () => {
  const tickets: TicketLike[] = [
    { status: 'open', priority: 'urgent', assignee_id: null },
    { status: 'open', priority: 'high', assignee_id: 2 },
    { status: 'in_progress', priority: 'normal', assignee_id: 2 },
    { status: 'on_hold', priority: 'low', assignee_id: null },
    { status: 'resolved', priority: 'normal', assignee_id: 3 },
    { status: 'closed', priority: 'normal', assignee_id: 3 },
  ];

  it('counts totals, open, and unassigned correctly', () => {
    const stats = computeStats(tickets);
    expect(stats.total).toBe(6);
    // open = open + in_progress + on_hold
    expect(stats.open).toBe(4);
    // unassigned among OPEN tickets only (2 of them)
    expect(stats.unassigned).toBe(2);
  });

  it('breaks down by status and priority', () => {
    const stats = computeStats(tickets);
    expect(stats.byStatus.open).toBe(2);
    expect(stats.byStatus.closed).toBe(1);
    expect(stats.byPriority.normal).toBe(3);
    expect(stats.byPriority.urgent).toBe(1);
  });

  it('handles an empty list', () => {
    const stats = computeStats([]);
    expect(stats.total).toBe(0);
    expect(stats.open).toBe(0);
    expect(stats.byStatus.resolved).toBe(0);
  });
});

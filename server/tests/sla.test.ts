import { describe, it, expect } from 'vitest';
import {
  computeSlaDueAt,
  getSlaStatus,
  SLA_RESOLUTION_MINUTES,
} from '../src/sla.js';

describe('computeSlaDueAt', () => {
  it('adds the priority resolution window to the creation time', () => {
    const created = '2026-07-11T10:00:00.000Z';
    // urgent = 4h
    expect(computeSlaDueAt('urgent', created)).toBe('2026-07-11T14:00:00.000Z');
    // low = 72h
    expect(computeSlaDueAt('low', created)).toBe('2026-07-14T10:00:00.000Z');
  });

  it('throws on an invalid priority', () => {
    // @ts-expect-error deliberately invalid
    expect(() => computeSlaDueAt('whenever', '2026-07-11T10:00:00Z')).toThrow(/priority/);
  });

  it('throws on an invalid date', () => {
    expect(() => computeSlaDueAt('normal', 'not-a-date')).toThrow(/Invalid/);
  });
});

describe('getSlaStatus for open tickets', () => {
  const created = '2026-07-11T10:00:00.000Z';

  it('is ok early in the window', () => {
    const now = '2026-07-11T11:00:00.000Z'; // 1h into a 4h urgent window
    const sla = getSlaStatus({ priority: 'urgent', createdAt: created, now });
    expect(sla.state).toBe('ok');
    expect(sla.minutesRemaining).toBe(180);
  });

  it('is at_risk inside the final quarter of the window', () => {
    // urgent window 240m; final quarter is <=60m remaining. 3.5h in => 30m left.
    const now = '2026-07-11T13:30:00.000Z';
    const sla = getSlaStatus({ priority: 'urgent', createdAt: created, now });
    expect(sla.state).toBe('at_risk');
    expect(sla.minutesRemaining).toBe(30);
  });

  it('is breached past the deadline', () => {
    const now = '2026-07-11T15:00:00.000Z'; // 1h past a 4h window
    const sla = getSlaStatus({ priority: 'urgent', createdAt: created, now });
    expect(sla.state).toBe('breached');
    expect(sla.minutesRemaining).toBeLessThan(0);
  });

  it('uses the correct window per priority', () => {
    expect(SLA_RESOLUTION_MINUTES.high).toBe(480);
    const now = '2026-07-11T18:00:00.000Z'; // 8h in, exactly at high deadline
    const sla = getSlaStatus({ priority: 'high', createdAt: created, now });
    expect(sla.minutesRemaining).toBe(0);
  });
});

describe('getSlaStatus for resolved tickets', () => {
  const created = '2026-07-11T10:00:00.000Z';

  it('is met when resolved before the deadline', () => {
    const sla = getSlaStatus({
      priority: 'normal',
      createdAt: created,
      resolvedAt: '2026-07-11T12:00:00.000Z',
    });
    expect(sla.state).toBe('met');
  });

  it('is breached when resolved after the deadline', () => {
    const sla = getSlaStatus({
      priority: 'urgent', // 4h
      createdAt: created,
      resolvedAt: '2026-07-11T20:00:00.000Z', // 10h later
    });
    expect(sla.state).toBe('breached');
  });
});

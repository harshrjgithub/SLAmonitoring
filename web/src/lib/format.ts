import type { SlaStatus } from './types';

/** Human-friendly relative time, e.g. "3h ago", "in 2d". */
export function relativeTime(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  const past = diffMs < 0;
  const mins = Math.round(Math.abs(diffMs) / 60_000);
  let value: string;
  if (mins < 1) value = 'just now';
  else if (mins < 60) value = `${mins}m`;
  else if (mins < 60 * 24) value = `${Math.round(mins / 60)}h`;
  else value = `${Math.round(mins / (60 * 24))}d`;
  if (value === 'just now') return value;
  return past ? `${value} ago` : `in ${value}`;
}

export function slaLabel(sla: SlaStatus): string {
  switch (sla.state) {
    case 'met': return 'SLA met';
    case 'breached':
      return sla.minutesRemaining < 0
        ? `SLA breached ${relativeTime(sla.dueAt)}`
        : 'SLA breached';
    case 'at_risk': return `Due ${relativeTime(sla.dueAt)}`;
    default: return `Due ${relativeTime(sla.dueAt)}`;
  }
}

import {
  PRIORITY_LABELS, STATUS_LABELS, type Priority, type SlaStatus, type Status,
} from '../lib/types';
import { slaLabel } from '../lib/format';

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge status-${status}`}>{STATUS_LABELS[status]}</span>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={`badge priority-${priority}`}>{PRIORITY_LABELS[priority]}</span>;
}

export function SlaBadge({ sla }: { sla: SlaStatus }) {
  return <span className={`badge sla-${sla.state}`}>{slaLabel(sla)}</span>;
}

export type Role = 'admin' | 'agent' | 'user';
export type Status = 'open' | 'in_progress' | 'on_hold' | 'resolved' | 'closed';
export type Priority = 'urgent' | 'high' | 'normal' | 'low';
export type Category =
  | 'hardware' | 'software' | 'network' | 'account_access' | 'email' | 'other';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
}

export interface SlaStatus {
  state: 'ok' | 'at_risk' | 'breached' | 'met';
  dueAt: string;
  minutesRemaining: number;
}

export interface Ticket {
  id: number;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  category: string;
  requester_id: number;
  assignee_id: number | null;
  requester_name: string;
  assignee_name: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  sla: SlaStatus;
  allowedTransitions: Status[];
}

export interface Comment {
  id: number;
  ticket_id: number;
  author_id: number;
  author_name: string;
  author_role: Role;
  body: string;
  created_at: string;
}

export interface Stats {
  total: number;
  open: number;
  unassigned: number;
  byStatus: Record<Status, number>;
  byPriority: Record<Priority, number>;
  slaBreached: number;
  slaAtRisk: number;
}

export interface Agent {
  id: number;
  name: string;
  role: Role;
}

export const STATUS_LABELS: Record<Status, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

export const CATEGORY_LABELS: Record<string, string> = {
  hardware: 'Hardware',
  software: 'Software',
  network: 'Network',
  account_access: 'Account / Access',
  email: 'Email',
  other: 'Other',
};

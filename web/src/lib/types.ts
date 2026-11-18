export type Role = 'admin' | 'agent' | 'user';
export type Status = 'open' | 'assigned' | 'in_progress' | 'on_hold' | 'escalated' | 'resolved' | 'closed' | 'reopened';
export type Priority = 'critical' | 'urgent' | 'high' | 'medium' | 'normal' | 'low';
export type Category =
  | 'core_banking' | 'network' | 'hardware' | 'printers_scanners' | 'account_access'
  | 'email' | 'banking_app' | 'cybersecurity' | 'atm_payments' | 'software'
  | 'hr_confidential' | 'other';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  employee_id?: string | null;
  phone?: string | null;
  designation?: string | null;
  department_name?: string | null;
  branch_name?: string | null;
  team_name?: string | null;
  account_status?: 'active' | 'inactive';
  must_change_password?: boolean;
  permissions?: string[];
  team_id?: number | null;
}

export interface Employee {
  id: number; name: string; email: string; employee_id: string;
  phone: string | null; designation: string; account_status: 'active' | 'inactive'; role: Role;
  branch_name: string | null; department_name: string | null; team_name: string | null;
}

export interface TicketAttachment { id:number; file_name:string; mime_type:string; size_bytes:number; file_url:string; kind:string; is_internal:number; }

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
  affected_user_id?: number | null;
  affected_name?: string | null;
  department_id?: number | null;
  department_name?: string | null;
  branch_id?: number | null;
  branch_name?: string | null;
  team_id?: number | null;
  team_name?: string | null;
  resolution_description?: string | null;
  resolved_by?: number | null;
  confirmed_by?: number | null;
  confirmed_at?: string | null;
  reopen_reason?: string | null;
  reopening_reason?: string | null;
  reopened_by?: number | null;
  reopened_at?: string | null;
  closure_method?: 'manual' | 'automatic' | 'manager_override';
  sensitivity?: 'normal' | 'restricted';
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
  is_internal?: number;
  created_at: string;
}

export interface TicketHistory {
  id: number;
  ticket_id: number;
  actor_id: number | null;
  actor_name: string | null;
  action: string;
  details: string;
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
  assigned: 'Assigned',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  escalated: 'Escalated',
  resolved: 'Resolved',
  closed: 'Closed',
  reopened: 'Reopened',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  critical: 'Critical',
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  normal: 'Normal',
  low: 'Low',
};

export const CATEGORY_LABELS: Record<string, string> = {
  core_banking: 'Core Banking System',
  hardware: 'Hardware',
  printers_scanners: 'Printers and Scanners',
  software: 'Software',
  network: 'Network',
  account_access: 'Account / Access',
  email: 'Email',
  banking_app: 'Banking Application Support',
  cybersecurity: 'Cybersecurity',
  atm_payments: 'ATM and Payment Infrastructure',
  hr_confidential: 'Confidential HR Support',
  other: 'Other',
};

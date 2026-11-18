import type {
  Agent, Comment, Employee, Stats, Ticket, TicketHistory, User,
} from './types';

const TOKEN_KEY = 'helpdesk_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.error ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface TicketFilters {
  status?: string;
  priority?: string;
  assignee?: string;
  q?: string; category?: string; department_id?: string; branch_id?: string; assignee_id?: string; team_id?: string; sort?: string; direction?: string;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  register: (email: string, name: string, password: string) =>
    request<{ token: string; user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, name, password }),
    }),

  me: () => request<{ user: User }>('/auth/me'),

  changePassword: (newPassword: string, currentPassword?: string) =>
    request<{ changed: boolean }>('/auth/change-password', { method: 'POST', body: JSON.stringify({ newPassword, currentPassword }) }),

  employees: (q = '') => request<{ employees: Employee[] }>(`/employees?q=${encodeURIComponent(q)}`),
  createEmployee: (input: { name: string; email: string; employee_id: string; role: string; designation: string }) =>
    request<{ employee: Employee; temporaryPassword: string }>('/employees', { method: 'POST', body: JSON.stringify(input) }),
  updateEmployee: (id: number, changes: Partial<Employee>) =>
    request<{ employee: Employee }>(`/employees/${id}`, { method: 'PATCH', body: JSON.stringify(changes) }),
  organisation: () => request<{ branches: Array<{id:number;name:string}>; departments: Array<{id:number;name:string}>; teams: Array<{id:number;name:string}>; roles: Array<{id:number;name:string;role_key:string}> }>('/organisation'),
  directory: () => request<{employees:Array<{id:number;name:string;email:string;employee_id:string;role:string;department_id:number|null;department_name:string|null;branch_id:number|null;branch_name:string|null;team_id:number|null}>}>('/organisation/directory'),
  createTeam: (input: { name: string; description?: string }) => request<{ team: {id:number;name:string} }>('/organisation/teams', { method: 'POST', body: JSON.stringify(input) }),
  createRole: (input: { name: string; description?: string; permissions: string[] }) => request('/organisation/roles', { method: 'POST', body: JSON.stringify(input) }),
  permissions: () => request<{permissions:Array<{id:number;name:string;permission_key:string;description:string}>}>('/organisation/permissions'),

  listTickets: (filters: TicketFilters = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
    const qs = params.toString();
    return request<{ tickets: Ticket[] }>(`/tickets${qs ? `?${qs}` : ''}`);
  },

  getTicket: (id: number) =>
    request<{ ticket: Ticket; comments: Comment[]; history: TicketHistory[]; attachments?: import('./types').TicketAttachment[] }>(`/tickets/${id}`),

  createTicket: (input: {
    title: string; description: string; priority: string; category: string;
    department_id?: number | null; affected_user_id?: number | null;
    assignee_id?: number | null; team_id?: number | null;
    attachments?: Array<{file_name:string;mime_type:string;size_bytes:number;base64:string}>;
  }) =>
    request<{ ticket: Ticket }>('/tickets', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateTicket: (
    id: number,
    changes: { status?: string; priority?: string; assignee_id?: number | null },
  ) =>
    request<{ ticket: Ticket }>(`/tickets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),

  addComment: (ticketId: number, body: string) =>
    request<{ comment: Comment }>(`/tickets/${ticketId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),

  ticketAction: (ticketId: number, action: string, input: Record<string, unknown> = {}) =>
    request<{ ticket: Ticket }>(`/tickets/${ticketId}/actions`, {
      method: 'POST',
      body: JSON.stringify({ action, ...input }),
    }),

  notifications: () => request<{notifications:Array<{id:number;ticket_id:number|null;type:string;message:string;is_read:number;created_at:string;ticket_title:string|null}>}>('/notifications'),
  markNotificationRead: (id:number) => request<{read:boolean}>(`/notifications/${id}/read`,{method:'PATCH'}),
  markAllNotificationsRead: () => request<{updated:number}>('/notifications/read-all',{method:'PATCH'}),

  stats: () => request<Stats>('/stats'),

  agents: () => request<{ agents: Agent[] }>('/stats/agents'),
};

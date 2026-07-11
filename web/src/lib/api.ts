import type {
  Agent, Comment, Stats, Ticket, User,
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
  assignee?: 'me' | 'unassigned';
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

  listTickets: (filters: TicketFilters = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
    const qs = params.toString();
    return request<{ tickets: Ticket[] }>(`/tickets${qs ? `?${qs}` : ''}`);
  },

  getTicket: (id: number) =>
    request<{ ticket: Ticket; comments: Comment[] }>(`/tickets/${id}`),

  createTicket: (input: {
    title: string; description: string; priority: string; category: string;
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

  stats: () => request<Stats>('/stats'),

  agents: () => request<{ agents: Agent[] }>('/stats/agents'),
};

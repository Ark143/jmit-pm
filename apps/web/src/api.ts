import type {
  CommentItem,
  DashboardData,
  Member,
  Priority,
  ProjectDetail,
  ProjectSummary,
  Role,
  SessionPayload,
  SessionUser,
  Status,
  StatusCategory,
  TaskDetail,
  TaskListItem,
  TaskWithProject,
  TimeLogItem,
  WorkspaceDetail,
  WorkspaceListItem,
  WorkspaceRef,
} from "./types";

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3000/api";
const TOKEN_KEY = "jmit.token";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = tokenStore.get();

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(
      `Can't reach the API at ${BASE}. If this is a fresh deployment, the backend has not been started yet.`,
      0,
    );
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const data = text ? safeJson(text) : null;

  if (!response.ok) {
    const message =
      (data && typeof data === "object" && "message" in data
        ? Array.isArray((data as { message: unknown }).message)
          ? ((data as { message: string[] }).message).join(", ")
          : String((data as { message: unknown }).message)
        : null) ?? `Request failed (${response.status})`;

    if (response.status === 401 && token) tokenStore.clear();
    throw new ApiError(message, response.status);
  }

  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  statusId?: string;
  priority?: Priority;
  assigneeId?: string | null;
  dueDate?: string | null;
  startDate?: string | null;
  estimateHours?: number | null;
  parentId?: string;
}

export const api = {
  auth: {
    register: (body: { email: string; password: string; name: string }) =>
      request<SessionPayload>("/auth/register", { method: "POST", body }),
    login: (body: { email: string; password: string }) =>
      request<SessionPayload>("/auth/login", { method: "POST", body }),
    me: () => request<{ user: SessionUser; workspaces: WorkspaceRef[] }>("/auth/me"),
  },

  workspaces: {
    list: () => request<WorkspaceListItem[]>("/workspaces"),
    create: (body: { name: string }) =>
      request<{ id: string; name: string; role: Role }>("/workspaces", { method: "POST", body }),
    get: (id: string) => request<WorkspaceDetail>(`/workspaces/${id}`),
    dashboard: (id: string) => request<DashboardData>(`/workspaces/${id}/dashboard`),
    addMember: (id: string, body: { email: string; role?: Role }) =>
      request<Member>(`/workspaces/${id}/members`, { method: "POST", body }),
    removeMember: (id: string, userId: string) =>
      request<{ ok: boolean }>(`/workspaces/${id}/members/${userId}`, { method: "DELETE" }),
    tasks: (id: string, scope: "assigned" | "created" | "overdue" | "done") =>
      request<TaskWithProject[]>(`/workspaces/${id}/tasks?scope=${scope}`),
  },

  projects: {
    create: (workspaceId: string, body: { name: string; key: string; color?: string; description?: string }) =>
      request<ProjectSummary & { statuses: Status[] }>(`/workspaces/${workspaceId}/projects`, {
        method: "POST",
        body,
      }),
    get: (id: string) => request<ProjectDetail>(`/projects/${id}`),
    update: (id: string, body: { name?: string; description?: string; color?: string; archived?: boolean }) =>
      request<ProjectSummary>(`/projects/${id}`, { method: "PATCH", body }),
    remove: (id: string) => request<{ ok: boolean }>(`/projects/${id}`, { method: "DELETE" }),
    addStatus: (id: string, body: { name: string; category?: StatusCategory }) =>
      request<Status>(`/projects/${id}/statuses`, { method: "POST", body }),
    updateStatus: (statusId: string, body: { name?: string; category?: StatusCategory }) =>
      request<Status>(`/statuses/${statusId}`, { method: "PATCH", body }),
    removeStatus: (statusId: string) =>
      request<{ ok: boolean }>(`/statuses/${statusId}`, { method: "DELETE" }),
  },

  tasks: {
    list: (projectId: string, filters: { statusId?: string; assigneeId?: string; q?: string; priority?: Priority } = {}) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (value) params.set(key, String(value));
      }
      const query = params.toString();
      return request<TaskListItem[]>(`/projects/${projectId}/tasks${query ? `?${query}` : ""}`);
    },
    create: (projectId: string, body: CreateTaskInput) =>
      request<TaskDetail>(`/projects/${projectId}/tasks`, { method: "POST", body }),
    get: (id: string) => request<TaskDetail>(`/tasks/${id}`),
    update: (
      id: string,
      body: {
        title?: string;
        description?: string | null;
        statusId?: string;
        priority?: Priority;
        assigneeId?: string | null;
        dueDate?: string | null;
        startDate?: string | null;
        estimateHours?: number | null;
      },
    ) => request<TaskDetail>(`/tasks/${id}`, { method: "PATCH", body }),
    move: (id: string, body: { statusId: string; position: number }) =>
      request<TaskListItem>(`/tasks/${id}/move`, { method: "PATCH", body }),
    remove: (id: string) => request<{ ok: boolean }>(`/tasks/${id}`, { method: "DELETE" }),
    comment: (id: string, body: string) =>
      request<CommentItem>(`/tasks/${id}/comments`, { method: "POST", body: { body } }),
    removeComment: (id: string) =>
      request<{ ok: boolean }>(`/comments/${id}`, { method: "DELETE" }),
    logTime: (id: string, body: { minutes: number; note?: string }) =>
      request<TimeLogItem>(`/tasks/${id}/time`, { method: "POST", body }),
  },
};

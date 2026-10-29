import type {
  AttachmentItem,
  Checklist,
  ChecklistItem,
  CommentItem,
  CustomField,
  CustomFieldType,
  CustomFieldValue,
  DashboardData,
  FilterPreset,
  Member,
  Priority,
  ProjectDetail,
  ProjectSummary,
  Recurrence,
  RecurrenceRule,
  ReminderItem,
  Role,
  SessionPayload,
  SessionUser,
  Status,
  StatusCategory,
  Tag,
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

function authHeaders(): Record<string, string> {
  const token = tokenStore.get();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function errorMessage(data: unknown, status: number) {
  return (
    (data && typeof data === "object" && "message" in data
      ? Array.isArray((data as { message: unknown }).message)
        ? ((data as { message: string[] }).message).join(", ")
        : String((data as { message: unknown }).message)
      : null) ?? `Request failed (${status})`
  );
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
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
    if (response.status === 401 && tokenStore.get()) tokenStore.clear();
    throw new ApiError(errorMessage(data, response.status), response.status);
  }

  return data as T;
}

async function upload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: authHeaders(),
      body: form,
    });
  } catch {
    throw new ApiError("Can't reach the API right now.", 0);
  }

  const data = safeJson(await response.text());
  if (!response.ok) {
    if (response.status === 401 && tokenStore.get()) tokenStore.clear();
    throw new ApiError(errorMessage(data, response.status), response.status);
  }

  return data as T;
}

export async function downloadFile(path: string, filename: string) {
  const response = await fetch(`${BASE}${path}`, { headers: authHeaders() });
  if (!response.ok) {
    throw new ApiError(`Could not download ${filename}`, response.status);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
  plannedMinutes?: number | null;
  parentId?: string;
}

export type TaskScope = "assigned" | "created" | "overdue" | "done" | "deadlines";

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
    tasks: (id: string, scope: TaskScope) =>
      request<TaskWithProject[]>(`/workspaces/${id}/tasks?scope=${scope}`),
    tags: (id: string) => request<Tag[]>(`/workspaces/${id}/tags`),
    createTag: (id: string, body: { name: string; color?: string }) =>
      request<Tag>(`/workspaces/${id}/tags`, { method: "POST", body }),
    removeTag: (tagId: string) =>
      request<{ ok: boolean }>(`/tags/${tagId}`, { method: "DELETE" }),
    filters: (id: string, projectId?: string) =>
      request<FilterPreset[]>(
        `/workspaces/${id}/filters${projectId ? `?projectId=${projectId}` : ""}`,
      ),
    createFilter: (
      id: string,
      body: { name: string; projectId?: string; state: FilterPreset["state"] },
    ) => request<FilterPreset>(`/workspaces/${id}/filters`, { method: "POST", body }),
    updateFilter: (presetId: string, body: { name?: string; state?: FilterPreset["state"] }) =>
      request<FilterPreset>(`/filters/${presetId}`, { method: "PATCH", body }),
    removeFilter: (presetId: string) =>
      request<{ ok: boolean }>(`/filters/${presetId}`, { method: "DELETE" }),
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
    fields: (id: string) => request<CustomField[]>(`/projects/${id}/fields`),
    addField: (id: string, body: { name: string; type: CustomFieldType; options?: string[] }) =>
      request<CustomField>(`/projects/${id}/fields`, { method: "POST", body }),
    updateField: (
      fieldId: string,
      body: { name?: string; type?: CustomFieldType; options?: string[]; position?: number },
    ) => request<CustomField>(`/fields/${fieldId}`, { method: "PATCH", body }),
    removeField: (fieldId: string) =>
      request<{ ok: boolean }>(`/fields/${fieldId}`, { method: "DELETE" }),
  },

  tasks: {
    list: (
      projectId: string,
      filters: { statusId?: string; assigneeId?: string; q?: string; priority?: Priority; tag?: string } = {},
    ) => {
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
        plannedMinutes?: number | null;
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

    setTags: (id: string, tags: string[]) =>
      request<TaskDetail>(`/tasks/${id}/tags`, { method: "PUT", body: { tags } }),

    addChecklist: (id: string, title: string) =>
      request<Checklist>(`/tasks/${id}/checklists`, { method: "POST", body: { title } }),
    renameChecklist: (checklistId: string, title: string) =>
      request<Checklist>(`/checklists/${checklistId}`, { method: "PATCH", body: { title } }),
    removeChecklist: (checklistId: string) =>
      request<{ ok: boolean }>(`/checklists/${checklistId}`, { method: "DELETE" }),
    addChecklistItem: (
      checklistId: string,
      body: { text: string; assigneeId?: string | null; dueDate?: string | null },
    ) => request<ChecklistItem>(`/checklists/${checklistId}/items`, { method: "POST", body }),
    updateChecklistItem: (
      itemId: string,
      body: { text?: string; done?: boolean; assigneeId?: string | null; dueDate?: string | null },
    ) => request<ChecklistItem>(`/checklist-items/${itemId}`, { method: "PATCH", body }),
    removeChecklistItem: (itemId: string) =>
      request<{ ok: boolean }>(`/checklist-items/${itemId}`, { method: "DELETE" }),

    addObserver: (id: string, userId: string) =>
      request<TaskDetail>(`/tasks/${id}/observers`, { method: "POST", body: { userId } }),
    removeObserver: (id: string, userId: string) =>
      request<TaskDetail>(`/tasks/${id}/observers/${userId}`, { method: "DELETE" }),

    addReminder: (id: string, remindAt: string) =>
      request<ReminderItem>(`/tasks/${id}/reminders`, { method: "POST", body: { remindAt } }),
    removeReminder: (id: string) =>
      request<{ ok: boolean }>(`/reminders/${id}`, { method: "DELETE" }),
    dismissReminder: (id: string) =>
      request<{ ok: boolean }>(`/reminders/${id}/dismiss`, { method: "PATCH" }),

    addDependency: (id: string, dependsOnId: string) =>
      request<TaskDetail>(`/tasks/${id}/dependencies`, { method: "POST", body: { dependsOnId } }),
    removeDependency: (id: string, dependencyId: string) =>
      request<TaskDetail>(`/tasks/${id}/dependencies/${dependencyId}`, { method: "DELETE" }),

    setRecurrence: (id: string, body: { rule: RecurrenceRule; interval?: number }) =>
      request<Recurrence>(`/tasks/${id}/recurrence`, { method: "PUT", body }),
    clearRecurrence: (id: string) =>
      request<{ ok: boolean }>(`/tasks/${id}/recurrence`, { method: "DELETE" }),

    setCustomValue: (id: string, fieldId: string, value: string | null) =>
      request<CustomFieldValue | { fieldId: string; value: null }>(`/tasks/${id}/custom`, {
        method: "PATCH",
        body: { fieldId, value },
      }),

    uploadAttachment: (id: string, file: File) =>
      upload<AttachmentItem>(`/tasks/${id}/attachments`, file),
    removeAttachment: (attachmentId: string) =>
      request<{ ok: boolean }>(`/attachments/${attachmentId}`, { method: "DELETE" }),
    downloadAttachment: (attachment: AttachmentItem) =>
      downloadFile(`/attachments/${attachment.id}`, attachment.name),
  },
};

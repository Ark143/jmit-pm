export type Role = "OWNER" | "ADMIN" | "MEMBER";
export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type StatusCategory = "TODO" | "IN_PROGRESS" | "DONE";
export type CustomFieldType = "TEXT" | "NUMBER" | "DATE" | "SELECT" | "CHECKBOX" | "URL";
export type RecurrenceRule = "DAILY" | "WEEKLY" | "MONTHLY";

export interface User {
  id: string;
  name: string;
  email: string;
  color: string;
}

export interface SessionUser extends User {
  createdAt: string;
}

export interface WorkspaceRef {
  id: string;
  name: string;
  role: Role;
}

export interface WorkspaceListItem extends WorkspaceRef {
  projectCount: number;
  memberCount: number;
  openTasks: number;
}

export interface Status {
  id: string;
  projectId: string;
  name: string;
  category: StatusCategory;
  position: number;
  taskCount?: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  key: string;
  color: string;
  description: string | null;
  statuses: Status[];
  taskCount: number;
  doneCount: number;
}

export interface Member {
  role: Role;
  joinedAt: string;
  user: User;
}

export interface WorkspaceDetail {
  id: string;
  name: string;
  role: Role;
  members: Member[];
  projects: ProjectSummary[];
}

export interface Tag {
  id: string;
  workspaceId: string;
  name: string;
  color: string;
  createdAt: string;
  _count?: { tasks: number };
}

export interface TaskCounts {
  comments: number;
  subtasks: number;
  timeLogs: number;
  attachments: number;
}

export interface TaskListItem {
  id: string;
  number: number;
  title: string;
  priority: Priority;
  position: number;
  statusId: string;
  projectId: string;
  parentId: string | null;
  startDate: string | null;
  dueDate: string | null;
  plannedMinutes: number | null;
  assignee: User | null;
  tags: Tag[];
  _count: TaskCounts;
}

export interface TaskWithProject extends TaskListItem {
  status: Pick<Status, "id" | "name" | "category">;
  project: Pick<ProjectSummary, "id" | "name" | "key" | "color">;
}

export interface CommentItem {
  id: string;
  body: string;
  createdAt: string;
  author: User;
}

export interface TimeLogItem {
  id: string;
  minutes: number;
  note: string | null;
  createdAt: string;
  user: User;
}

export interface ChecklistItem {
  id: string;
  checklistId: string;
  text: string;
  done: boolean;
  assigneeId: string | null;
  dueDate: string | null;
  position: number;
  assignee: User | null;
}

export interface Checklist {
  id: string;
  taskId: string;
  title: string;
  position: number;
  items: ChecklistItem[];
}

export interface ReminderItem {
  id: string;
  taskId: string;
  userId: string;
  remindAt: string;
  dismissed: boolean;
  createdAt: string;
}

export interface AttachmentItem {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
}

export interface DependencyLink {
  id: string;
  task: {
    id: string;
    number: number;
    title: string;
    status: { id: string; name: string; category: StatusCategory };
  };
}

export interface Recurrence {
  id: string;
  taskId: string;
  rule: RecurrenceRule;
  interval: number;
  nextAt: string | null;
}

export interface CustomField {
  id: string;
  projectId: string;
  name: string;
  type: CustomFieldType;
  options: string[];
  position: number;
}

export interface CustomFieldValue {
  id: string;
  fieldId: string;
  taskId: string;
  value: string | null;
}

export interface FilterPreset {
  id: string;
  workspaceId: string;
  userId: string;
  projectId: string | null;
  name: string;
  state: {
    statusId?: string;
    assigneeId?: string;
    priority?: Priority;
    tag?: string;
    q?: string;
  };
  createdAt: string;
}

export interface TaskDetail {
  id: string;
  number: number;
  title: string;
  description: string | null;
  priority: Priority;
  position: number;
  statusId: string;
  projectId: string;
  parentId: string | null;
  startDate: string | null;
  dueDate: string | null;
  plannedMinutes: number | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  assignee: User | null;
  creator: User;
  status: Status;
  project: {
    id: string;
    name: string;
    key: string;
    color: string;
    workspaceId: string;
    customFields: CustomField[];
  };
  subtasks: TaskListItem[];
  comments: CommentItem[];
  timeLogs: TimeLogItem[];
  tags: Tag[];
  checklists: Checklist[];
  observers: User[];
  reminders: ReminderItem[];
  attachments: AttachmentItem[];
  customValues: CustomFieldValue[];
  customFields: CustomField[];
  blockedBy: DependencyLink[];
  blocks: DependencyLink[];
  recurrence: Recurrence | null;
  loggedMinutes: number;
}

export interface ProjectDetail {
  id: string;
  workspaceId: string;
  name: string;
  key: string;
  color: string;
  description: string | null;
  createdAt: string;
  statuses: Status[];
  customFields: CustomField[];
  taskCount: number;
}

export interface DashboardReminder {
  id: string;
  remindAt: string;
  task: {
    id: string;
    number: number;
    title: string;
    dueDate: string | null;
    project: { id: string; name: string; key: string; color: string };
  };
}

export interface DashboardData {
  counts: { open: number; overdue: number; dueThisWeek: number; completedThisWeek: number };
  byPriority: Array<{ priority: Priority; count: number }>;
  byStatus: Array<{ statusId: string; count: number }>;
  workload: Array<{ user: User; open: number; urgent: number; overdue: number }>;
  upcoming: Array<{
    id: string;
    number: number;
    title: string;
    dueDate: string | null;
    priority: Priority;
    assignee: User | null;
    project: { id: string; name: string; key: string; color: string };
    status: { id: string; name: string; category: StatusCategory };
  }>;
  reminders: DashboardReminder[];
  activity: Array<{
    id: string;
    type: string;
    message: string;
    taskId: string | null;
    createdAt: string;
    actor: User;
  }>;
}

export interface SessionPayload {
  token: string;
  user: SessionUser;
  workspaces: WorkspaceRef[];
}

export interface InvitePreview {
  workspaceId: string;
  workspaceName: string;
  inviterName: string;
  email: string;
  role: Role;
  status: "PENDING" | "ACCEPTED" | "REVOKED";
  expiresAt: string;
}

export interface WorkspaceInvite {
  id: string;
  workspaceId: string;
  email: string;
  role: Role;
  token: string;
  status: "PENDING" | "ACCEPTED" | "REVOKED";
  invitedById: string;
  acceptedById: string | null;
  expiresAt: string;
  createdAt: string;
  invitedBy: User;
}

export interface AppNotification {
  id: string;
  userId: string;
  workspaceId: string;
  actorId: string | null;
  taskId: string | null;
  type: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
  actor: Pick<User, "id" | "name" | "color"> | null;
  task: {
    id: string;
    number: number;
    title: string;
    project: Pick<ProjectSummary, "id" | "key" | "color">;
  } | null;
}

export interface NotificationFeed {
  items: AppNotification[];
  unread: number;
}

export interface TaskHistoryEntry {
  id: string;
  type: string;
  message: string;
  taskId: string | null;
  createdAt: string;
  actor: User;
}

export interface SearchResults {
  tasks: Array<{
    id: string;
    number: number;
    title: string;
    priority: Priority;
    dueDate: string | null;
    assignee: User | null;
    status: Pick<Status, "id" | "name" | "category">;
    project: Pick<ProjectSummary, "id" | "name" | "key" | "color">;
  }>;
  projects: Array<Pick<ProjectSummary, "id" | "name" | "key" | "color">>;
  tags: Tag[];
}

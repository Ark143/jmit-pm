export type Role = "OWNER" | "ADMIN" | "MEMBER";
export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type StatusCategory = "TODO" | "IN_PROGRESS" | "DONE";

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

export interface TaskCounts {
  comments: number;
  subtasks: number;
  timeLogs: number;
}

export interface TaskListItem {
  id: string;
  number: number;
  title: string;
  priority: Priority;
  position: number;
  statusId: string;
  projectId: string;
  dueDate: string | null;
  assignee: User | null;
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

export interface TaskDetail {
  id: string;
  number: number;
  title: string;
  description: string | null;
  priority: Priority;
  position: number;
  statusId: string;
  projectId: string;
  startDate: string | null;
  dueDate: string | null;
  estimateHours: number | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  assignee: User | null;
  creator: User;
  status: Status;
  project: { id: string; name: string; key: string; color: string; workspaceId: string };
  subtasks: TaskListItem[];
  comments: CommentItem[];
  timeLogs: TimeLogItem[];
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
  taskCount: number;
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

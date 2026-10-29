import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api";
import { dueLabel, isOverdue } from "../lib";
import { Avatar, EmptyState, PriorityBadge, Spinner } from "../ui";
import type { TaskWithProject, WorkspaceDetail } from "../types";
import { TaskPanel } from "./TaskPanel";

const SCOPES = [
  { id: "assigned", label: "Assigned to me" },
  { id: "created", label: "Created by me" },
  { id: "overdue", label: "Overdue" },
  { id: "deadlines", label: "Deadlines" },
  { id: "done", label: "Completed" },
] as const;

type Scope = (typeof SCOPES)[number]["id"];

export function MyTasksPage({ workspace }: { workspace: WorkspaceDetail }) {
  const [scope, setScope] = useState<Scope>("assigned");
  const [tasks, setTasks] = useState<TaskWithProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setTasks(await api.workspaces.tasks(workspace.id, scope));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load your tasks");
      setTasks([]);
    }
  }, [workspace.id, scope]);

  useEffect(() => {
    setTasks(null);
    void load();
  }, [load]);

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1>My tasks</h1>
          <p className="page__sub">Everything assigned across your projects in this workspace.</p>
        </div>
      </header>

      <div className="tabs tabs--inline" role="tablist">
        {SCOPES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={scope === item.id}
            className={scope === item.id ? "is-active" : ""}
            onClick={() => setScope(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error ? <EmptyState title="Something broke" body={error} /> : null}

      {!tasks ? (
        <Spinner />
      ) : tasks.length === 0 ? (
        <EmptyState
          title="Nothing here"
          body={
            scope === "done"
              ? "No completed tasks yet."
              : scope === "overdue"
                ? "No overdue work. Good place to be."
                : "Assign yourself a task from a project board and it shows up here."
          }
        />
      ) : (
        <ul className="task-rows task-rows--card">
          {tasks.map((task) => (
            <li key={task.id}>
              <button
                type="button"
                className="task-rows__link"
                onClick={() => setOpenTaskId(task.id)}
              >
                <span className="mono" style={{ color: task.project.color }}>
                  {task.project.key}-{task.number}
                </span>
                <span className="task-rows__title">{task.title}</span>
                <span className="task-rows__project">{task.project.name}</span>
                <PriorityBadge priority={task.priority} />
                <span className={`due ${isOverdue(task.dueDate, task.status.category) ? "due--late" : ""}`}>
                  {dueLabel(task.dueDate) ?? "No date"}
                </span>
                {task.assignee ? <Avatar user={task.assignee} size={24} /> : <span className="unassigned">—</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      <TaskPanel
        taskId={openTaskId}
        members={workspace.members}
        onClose={() => setOpenTaskId(null)}
        onChanged={() => void load()}
      />
    </div>
  );
}

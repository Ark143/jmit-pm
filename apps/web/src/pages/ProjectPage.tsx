import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError, api } from "../api";
import { useAuth } from "../auth";
import { monthMatrix, dueLabel, isOverdue, toDateInput } from "../lib";
import { Avatar, EmptyState, PriorityBadge, Spinner } from "../ui";
import type { Priority, ProjectDetail, TaskListItem, WorkspaceDetail } from "../types";
import { TaskPanel } from "./TaskPanel";

type View = "board" | "list" | "calendar";

const PRIORITIES: Priority[] = ["URGENT", "HIGH", "MEDIUM", "LOW"];

export function ProjectPage({
  workspace,
  onWorkspaceChange,
}: {
  workspace: WorkspaceDetail;
  onWorkspaceChange: () => void;
}) {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useAuth();

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [tasks, setTasks] = useState<TaskListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("board");
  const [query, setQuery] = useState("");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState<"" | Priority>("");
  const [onlyMine, setOnlyMine] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const [draftColumn, setDraftColumn] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setError(null);
      const [detail, list] = await Promise.all([
        api.projects.get(projectId),
        api.tasks.list(projectId),
      ]);
      setProject(detail);
      setTasks(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the project");
      setTasks([]);
    }
  }, [projectId]);

  useEffect(() => {
    setProject(null);
    setTasks(null);
    setQuery("");
    setAssignee("");
    setPriority("");
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!tasks) return [];
    const needle = query.trim().toLowerCase();
    return tasks.filter((task) => {
      if (assignee && task.assignee?.id !== assignee) return false;
      if (priority && task.priority !== priority) return false;
      if (onlyMine && task.assignee?.id !== user?.id) return false;
      if (needle) {
        const haystack = `${task.number} ${task.title}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [tasks, query, assignee, priority, onlyMine, user?.id]);

  async function createTask(statusId: string, title: string) {
    if (!projectId || !title.trim()) return;
    try {
      await api.tasks.create(projectId, { title: title.trim(), statusId });
      setDraftTitle("");
      setDraftColumn(null);
      await load();
      onWorkspaceChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the task");
    }
  }

  async function moveTask(taskId: string, statusId: string, beforeId?: string) {
    if (!tasks) return;
    const column = tasks
      .filter((t) => t.statusId === statusId && t.id !== taskId)
      .sort((a, b) => a.position - b.position);

    let position: number;
    if (!beforeId) {
      position = (column.at(-1)?.position ?? 0) + 1;
    } else {
      const index = column.findIndex((t) => t.id === beforeId);
      if (index <= 0) {
        position = (column[0]?.position ?? 1) - 1;
      } else {
        position = (column[index - 1].position + column[index].position) / 2;
      }
    }

    const previous = tasks;
    setTasks(tasks.map((t) => (t.id === taskId ? { ...t, statusId, position } : t)));

    try {
      await api.tasks.move(taskId, { statusId, position });
      onWorkspaceChange();
    } catch (err) {
      setTasks(previous);
      setError(err instanceof ApiError ? err.message : "Could not move the task");
    }
  }

  if (error && !project) {
    return <EmptyState title="Project unavailable" body={error} />;
  }

  if (!project || !tasks) return <Spinner label="Loading project…" />;

  return (
    <div className="page">
      <header className="page__head page__head--row">
        <div>
          <div className="page__title">
            <span className="dot dot--lg" style={{ background: project.color }} />
            <h1>{project.name}</h1>
            <span className="mono page__key">{project.key}</span>
          </div>
          <p className="page__sub">
            {project.description || "No description yet."} · {project.taskCount} task
            {project.taskCount === 1 ? "" : "s"}
          </p>
        </div>

        <div className="view-switch" role="tablist" aria-label="View">
          {(["board", "list", "calendar"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={view === option}
              className={view === option ? "is-active" : ""}
              onClick={() => setView(option)}
            >
              {option[0].toUpperCase() + option.slice(1)}
            </button>
          ))}
        </div>
      </header>

      <div className="filters">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tasks…"
          aria-label="Search tasks"
        />
        <select value={assignee} onChange={(event) => setAssignee(event.target.value)} aria-label="Filter by assignee">
          <option value="">Anyone</option>
          {workspace.members.map((member) => (
            <option key={member.user.id} value={member.user.id}>
              {member.user.name}
            </option>
          ))}
        </select>
        <select
          value={priority}
          onChange={(event) => setPriority(event.target.value as "" | Priority)}
          aria-label="Filter by priority"
        >
          <option value="">Any priority</option>
          {PRIORITIES.map((value) => (
            <option key={value} value={value}>
              {value[0] + value.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={onlyMine} onChange={(event) => setOnlyMine(event.target.checked)} />
          Only mine
        </label>
        <span className="filters__count">
          {filtered.length} of {tasks.length}
        </span>
      </div>

      {error ? <p className="error-note">{error}</p> : null}

      {view === "board" ? (
        <div className="board">
          {project.statuses.map((status) => {
            const columnTasks = filtered
              .filter((task) => task.statusId === status.id)
              .sort((a, b) => a.position - b.position);

            return (
              <section
                key={status.id}
                className={`column ${dropTarget === status.id ? "is-over" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDropTarget(status.id);
                }}
                onDragLeave={() => setDropTarget((current) => (current === status.id ? null : current))}
                onDrop={(event) => {
                  event.preventDefault();
                  setDropTarget(null);
                  if (!draggingId) return;
                  void moveTask(draggingId, status.id);
                  setDraggingId(null);
                }}
                aria-label={`${status.name} column`}
              >
                <header className="column__head">
                  <span className={`column__dot column__dot--${status.category.toLowerCase()}`} />
                  <h2>{status.name}</h2>
                  <span className="pill">{columnTasks.length}</span>
                </header>

                <div className="column__body">
                  {columnTasks.map((task) => (
                    <article
                      key={task.id}
                      className={`task-card ${draggingId === task.id ? "is-dragging" : ""}`}
                      draggable
                      onDragStart={() => setDraggingId(task.id)}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDropTarget(null);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setDropTarget(status.id);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setDropTarget(null);
                        if (draggingId && draggingId !== task.id) {
                          void moveTask(draggingId, status.id, task.id);
                        }
                        setDraggingId(null);
                      }}
                    >
                      <button
                        type="button"
                        className="task-card__main"
                        onClick={() => setOpenTaskId(task.id)}
                      >
                        <span className="mono task-card__key">
                          {project.key}-{task.number}
                        </span>
                        <span className="task-card__title">{task.title}</span>
                        <span className="task-card__meta">
                          <PriorityBadge priority={task.priority} />
                          {task.dueDate ? (
                            <span
                              className={`due ${isOverdue(task.dueDate, status.category) ? "due--late" : ""}`}
                            >
                              {dueLabel(task.dueDate)}
                            </span>
                          ) : null}
                          <span className="task-card__spacer" />
                          {task._count.comments > 0 ? (
                            <span className="count" title={`${task._count.comments} comments`}>
                              💬 {task._count.comments}
                            </span>
                          ) : null}
                          {task._count.subtasks > 0 ? (
                            <span className="count" title={`${task._count.subtasks} subtasks`}>
                              ☑ {task._count.subtasks}
                            </span>
                          ) : null}
                          {task.assignee ? (
                            <Avatar user={task.assignee} size={22} />
                          ) : (
                            <span className="unassigned">—</span>
                          )}
                        </span>
                      </button>
                    </article>
                  ))}

                  {columnTasks.length === 0 ? <p className="column__empty">Drop tasks here</p> : null}
                </div>

                {draftColumn === status.id ? (
                  <form
                    className="column__composer"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void createTask(status.id, draftTitle);
                    }}
                  >
                    <input
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      placeholder="Task title"
                      autoFocus
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setDraftColumn(null);
                          setDraftTitle("");
                        }
                      }}
                    />
                    <div className="row row--end">
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => {
                          setDraftColumn(null);
                          setDraftTitle("");
                        }}
                      >
                        Cancel
                      </button>
                      <button type="submit" className="btn btn--sm btn--primary">
                        Add
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    type="button"
                    className="column__add"
                    onClick={() => {
                      setDraftColumn(status.id);
                      setDraftTitle("");
                    }}
                  >
                    + Add task
                  </button>
                )}
              </section>
            );
          })}
        </div>
      ) : null}

      {view === "list" ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">Title</th>
                <th scope="col">Status</th>
                <th scope="col">Assignee</th>
                <th scope="col">Priority</th>
                <th scope="col">Due</th>
              </tr>
            </thead>
            <tbody>
              {filtered
                .slice()
                .sort((a, b) => a.number - b.number)
                .map((task) => {
                  const status = project.statuses.find((s) => s.id === task.statusId);
                  return (
                    <tr key={task.id} onClick={() => setOpenTaskId(task.id)} tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") setOpenTaskId(task.id);
                      }}
                    >
                      <td className="mono">{project.key}-{task.number}</td>
                      <td className="table__title">{task.title}</td>
                      <td>{status?.name ?? "—"}</td>
                      <td>{task.assignee ? <Avatar user={task.assignee} size={22} /> : "—"}</td>
                      <td><PriorityBadge priority={task.priority} /></td>
                      <td className={isOverdue(task.dueDate, status?.category) ? "due--late" : ""}>
                        {task.dueDate ? toDateInput(task.dueDate) : "—"}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          {filtered.length === 0 ? <p className="hint table__empty">No tasks match these filters.</p> : null}
        </div>
      ) : null}

      {view === "calendar" ? (
        <CalendarView
          tasks={filtered}
          projectKey={project.key}
          onOpen={(id) => setOpenTaskId(id)}
        />
      ) : null}

      <TaskPanel
        taskId={openTaskId}
        members={workspace.members}
        onClose={() => setOpenTaskId(null)}
        onChanged={() => {
          void load();
          onWorkspaceChange();
        }}
      />
    </div>
  );
}

function CalendarView({
  tasks,
  projectKey,
  onOpen,
}: {
  tasks: TaskListItem[];
  projectKey: string;
  onOpen: (id: string) => void;
}) {
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));

  const cells = monthMatrix(cursor.getFullYear(), cursor.getMonth());
  const byDay = new Map<string, TaskListItem[]>();

  for (const task of tasks) {
    if (!task.dueDate) continue;
    const key = toDateInput(task.dueDate);
    const bucket = byDay.get(key) ?? [];
    bucket.push(task);
    byDay.set(key, bucket);
  }

  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="calendar">
      <header className="calendar__head">
        <button
          type="button"
          className="icon-btn"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          aria-label="Previous month"
        >
          ‹
        </button>
        <h2>{monthLabel}</h2>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          aria-label="Next month"
        >
          ›
        </button>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}
        >
          Today
        </button>
      </header>

      <div className="calendar__grid">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
          <div key={day} className="calendar__dow">
            {day}
          </div>
        ))}

        {cells.map((date) => {
          const key = toDateInput(date.toISOString());
          const dayTasks = byDay.get(key) ?? [];
          const isToday = key === toDateInput(today.toISOString());
          const outside = date.getMonth() !== cursor.getMonth();

          return (
            <div
              key={key}
              className={`calendar__cell ${outside ? "is-outside" : ""} ${isToday ? "is-today" : ""}`}
            >
              <span className="calendar__date">{date.getDate()}</span>
              <ul>
                {dayTasks.slice(0, 3).map((task) => (
                  <li key={task.id}>
                    <button type="button" onClick={() => onOpen(task.id)}>
                      <span className="mono">{projectKey}-{task.number}</span> {task.title}
                    </button>
                  </li>
                ))}
                {dayTasks.length > 3 ? <li className="calendar__more">+{dayTasks.length - 3} more</li> : null}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

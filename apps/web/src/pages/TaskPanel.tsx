import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, api } from "../api";
import { hoursLabel, isOverdue, dueLabel, toDateInput } from "../lib";
import { Avatar, ErrorNote, PriorityBadge, Spinner } from "../ui";
import type { Member, Priority, Status, TaskDetail } from "../types";

export function TaskPanel({
  taskId,
  members,
  onClose,
  onChanged,
}: {
  taskId: string | null;
  members: Member[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [comment, setComment] = useState("");
  const [subtask, setSubtask] = useState("");
  const [minutes, setMinutes] = useState("30");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!taskId) return;
    try {
      setError(null);
      const detail = await api.tasks.get(taskId);
      setTask(detail);
      setTitle(detail.title);
      setDescription(detail.description ?? "");
      setStatuses((await api.projects.get(detail.project.id)).statuses);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the task");
    }
  }, [taskId]);

  useEffect(() => {
    setTask(null);
    setError(null);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!taskId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [taskId, onClose]);

  if (!taskId) return null;

  async function patch(body: Parameters<typeof api.tasks.update>[1]) {
    if (!taskId) return;
    setBusy(true);
    setError(null);
    try {
      await api.tasks.update(taskId, body);
      await refresh();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function addComment(event: FormEvent) {
    event.preventDefault();
    if (!taskId || !comment.trim()) return;
    const body = comment.trim();
    setComment("");
    try {
      await api.tasks.comment(taskId, body);
      await refresh();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not post the comment");
    }
  }

  async function addSubtask(event: FormEvent) {
    event.preventDefault();
    if (!task || !subtask.trim()) return;
    const value = subtask.trim();
    setSubtask("");
    try {
      await api.tasks.create(task.project.id, {
        title: value,
        parentId: task.id,
        statusId: task.statusId,
        assigneeId: task.assignee?.id ?? null,
      });
      await refresh();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add the subtask");
    }
  }

  async function logTime(event: FormEvent) {
    event.preventDefault();
    if (!taskId) return;
    const value = Number(minutes);
    if (!Number.isFinite(value) || value <= 0) return;
    try {
      await api.tasks.logTime(taskId, { minutes: Math.round(value), note: note || undefined });
      setNote("");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not log time");
    }
  }

  async function remove() {
    if (!taskId) return;
    if (!window.confirm("Delete this task and its subtasks?")) return;
    try {
      await api.tasks.remove(taskId);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete the task");
    }
  }

  return (
    <div className="drawer-scrim" onMouseDown={onClose}>
      <aside
        className="drawer"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Task details"
      >
        {!task ? (
          <div className="drawer__loading">{error ? <ErrorNote message={error} /> : <Spinner label="Loading task…" />}</div>
        ) : (
          <>
            <header className="drawer__head">
              <div className="drawer__crumb">
                <span className="dot" style={{ background: task.project.color }} />
                <span className="mono">
                  {task.project.key}-{task.number}
                </span>
                <span className="drawer__project">{task.project.name}</span>
              </div>
              <button type="button" className="icon-btn" onClick={onClose} aria-label="Close task">
                ✕
              </button>
            </header>

            <div className="drawer__body">
              <input
                className="title-input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => {
                  if (title.trim() && title !== task.title) void patch({ title: title.trim() });
                }}
                aria-label="Task title"
              />

              <div className="meta-grid">
                <label className="field field--tight">
                  <span>Status</span>
                  <select
                    value={task.statusId}
                    onChange={(event) => void patch({ statusId: event.target.value })}
                  >
                    {statuses.map((status) => (
                      <option key={status.id} value={status.id}>
                        {status.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field field--tight">
                  <span>Priority</span>
                  <select
                    value={task.priority}
                    onChange={(event) => void patch({ priority: event.target.value as Priority })}
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </label>

                <label className="field field--tight">
                  <span>Assignee</span>
                  <select
                    value={task.assignee?.id ?? ""}
                    onChange={(event) => void patch({ assigneeId: event.target.value || null })}
                  >
                    <option value="">Unassigned</option>
                    {members.map((member) => (
                      <option key={member.user.id} value={member.user.id}>
                        {member.user.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field field--tight">
                  <span>Due date</span>
                  <input
                    type="date"
                    value={toDateInput(task.dueDate)}
                    onChange={(event) =>
                      void patch({
                        dueDate: event.target.value ? new Date(event.target.value).toISOString() : null,
                      })
                    }
                  />
                </label>

                <label className="field field--tight">
                  <span>Estimate (hours)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={task.estimateHours ?? ""}
                    onChange={(event) =>
                      void patch({
                        estimateHours: event.target.value === "" ? null : Number(event.target.value),
                      })
                    }
                  />
                </label>

                <div className="field field--tight">
                  <span>Time</span>
                  <p className="meta-value">{hoursLabel(task.estimateHours, task.loggedMinutes)}</p>
                </div>
              </div>

              <section className="drawer__section">
                <h3>Description</h3>
                <textarea
                  rows={4}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Add context, acceptance criteria, links…"
                />
                {description !== (task.description ?? "") ? (
                  <button
                    type="button"
                    className="btn btn--sm btn--primary"
                    onClick={() => void patch({ description })}
                    disabled={busy}
                  >
                    Save description
                  </button>
                ) : null}
              </section>

              <section className="drawer__section">
                <h3>
                  Subtasks <span className="pill">{task.subtasks.length}</span>
                </h3>
                <ul className="subtasks">
                  {task.subtasks.map((item) => (
                    <li key={item.id}>
                      <span className={`subtask__title ${item.statusId === task.statusId ? "" : ""}`}>
                        {item.title}
                      </span>
                      <PriorityBadge priority={item.priority} />
                    </li>
                  ))}
                </ul>
                <form className="inline-form" onSubmit={addSubtask}>
                  <input
                    value={subtask}
                    onChange={(event) => setSubtask(event.target.value)}
                    placeholder="Add a subtask…"
                  />
                  <button type="submit" className="btn btn--sm" disabled={!subtask.trim()}>
                    Add
                  </button>
                </form>
              </section>

              <section className="drawer__section">
                <h3>Time log</h3>
                <form className="inline-form" onSubmit={logTime}>
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={minutes}
                    onChange={(event) => setMinutes(event.target.value)}
                    aria-label="Minutes"
                    className="input--narrow"
                  />
                  <input
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="What did you work on?"
                  />
                  <button type="submit" className="btn btn--sm">
                    Log
                  </button>
                </form>
                {task.timeLogs.length > 0 ? (
                  <ul className="timelogs">
                    {task.timeLogs.map((log) => (
                      <li key={log.id}>
                        <Avatar user={log.user} size={20} />
                        <span className="timelogs__minutes">{log.minutes}m</span>
                        <span className="timelogs__note">{log.note ?? "No note"}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>

              <section className="drawer__section">
                <h3>
                  Comments <span className="pill">{task.comments.length}</span>
                </h3>
                <ul className="comments">
                  {task.comments.map((entry) => (
                    <li key={entry.id}>
                      <Avatar user={entry.author} size={26} />
                      <div>
                        <p className="comments__head">
                          <strong>{entry.author.name}</strong>
                          <time dateTime={entry.createdAt}>
                            {new Date(entry.createdAt).toLocaleString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                        </p>
                        <p className="comments__body">{entry.body}</p>
                      </div>
                      <button
                        type="button"
                        className="icon-btn icon-btn--sm"
                        onClick={async () => {
                          await api.tasks.removeComment(entry.id);
                          await refresh();
                        }}
                        aria-label="Delete comment"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                  {task.comments.length === 0 ? <li className="hint">No comments yet.</li> : null}
                </ul>
                <form className="inline-form" onSubmit={addComment}>
                  <input
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    placeholder="Write a comment…"
                  />
                  <button type="submit" className="btn btn--sm btn--primary" disabled={!comment.trim()}>
                    Post
                  </button>
                </form>
              </section>

              <ErrorNote message={error} />
            </div>

            <footer className="drawer__foot">
              <span className="hint">
                Created by {task.creator.name}
                {task.dueDate ? ` · due ${dueLabel(task.dueDate)}` : ""}
                {isOverdue(task.dueDate, task.status.category) ? " · overdue" : ""}
              </span>
              <button type="button" className="btn btn--danger btn--sm" onClick={() => void remove()}>
                Delete task
              </button>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}

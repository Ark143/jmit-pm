import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../api";
import { PRIORITY_META, dueLabel, isOverdue, timeAgo } from "../lib";
import { useLiveRefresh } from "../live";
import { Avatar, EmptyState, PriorityBadge, Spinner } from "../ui";
import type { DashboardData, WorkspaceDetail } from "../types";

export function DashboardPage({ workspace }: { workspace: WorkspaceDetail }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await api.workspaces.dashboard(workspace.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the dashboard");
    }
  }, [workspace.id]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  useLiveRefresh(() => void load());

  if (error) {
    return <EmptyState title="Dashboard unavailable" body={error} />;
  }

  if (!data) return <Spinner label="Crunching numbers…" />;

  const maxLoad = Math.max(1, ...data.workload.map((w) => w.open));

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1>Dashboard</h1>
          <p className="page__sub">
            {workspace.name} · {workspace.members.length} member
            {workspace.members.length === 1 ? "" : "s"} · {workspace.projects.length} project
            {workspace.projects.length === 1 ? "" : "s"}
          </p>
        </div>
      </header>

      <section className="stat-grid" aria-label="Key numbers">
        <article className="stat">
          <span className="stat__label">Open tasks</span>
          <strong className="stat__value">{data.counts.open}</strong>
          <span className="stat__foot">{data.counts.dueThisWeek} due this week</span>
        </article>
        <article className="stat stat--danger">
          <span className="stat__label">Overdue</span>
          <strong className="stat__value">{data.counts.overdue}</strong>
          <span className="stat__foot">{data.counts.overdue ? "needs attention" : "all clear"}</span>
        </article>
        <article className="stat stat--good">
          <span className="stat__label">Done this week</span>
          <strong className="stat__value">{data.counts.completedThisWeek}</strong>
          <span className="stat__foot">last 7 days</span>
        </article>
        <article className="stat">
          <span className="stat__label">Urgent open</span>
          <strong className="stat__value">
            {data.byPriority.find((p) => p.priority === "URGENT")?.count ?? 0}
          </strong>
          <span className="stat__foot">
            {data.byPriority.find((p) => p.priority === "HIGH")?.count ?? 0} high priority
          </span>
        </article>
      </section>

      <div className="dash-grid">
        <section className="card">
          <header className="card__head">
            <h2>Workload</h2>
            <span className="card__hint">open tasks per person</span>
          </header>
          <ul className="workload">
            {data.workload.map((row) => (
              <li key={row.user.id}>
                <Avatar user={row.user} size={28} />
                <div className="workload__body">
                  <div className="workload__top">
                    <strong>{row.user.name}</strong>
                    <span>
                      {row.open} open
                      {row.overdue > 0 ? <em className="workload__overdue"> · {row.overdue} overdue</em> : null}
                    </span>
                  </div>
                  <div className="bar">
                    <span
                      style={{
                        width: `${Math.max(4, (row.open / maxLoad) * 100)}%`,
                        background: row.overdue > 0 ? "var(--danger)" : "var(--accent)",
                      }}
                    />
                  </div>
                </div>
              </li>
            ))}
            {data.workload.length === 0 ? <li className="hint">No members yet.</li> : null}
          </ul>
        </section>

        <section className="card">
          <header className="card__head">
            <h2>Priority mix</h2>
            <span className="card__hint">open tasks</span>
          </header>
          <ul className="priority-mix">
            {(["URGENT", "HIGH", "MEDIUM", "LOW"] as const).map((priority) => {
              const count = data.byPriority.find((p) => p.priority === priority)?.count ?? 0;
              const pct = data.counts.open ? Math.round((count / data.counts.open) * 100) : 0;
              return (
                <li key={priority}>
                  <span className="priority-mix__label">
                    <span className="dot" style={{ background: PRIORITY_META[priority].color }} />
                    {PRIORITY_META[priority].label}
                  </span>
                  <div className="bar">
                    <span
                      style={{
                        width: `${Math.max(2, pct)}%`,
                        background: PRIORITY_META[priority].color,
                      }}
                    />
                  </div>
                  <span className="priority-mix__count">{count}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="card card--wide">
          <header className="card__head">
            <h2>Upcoming deadlines</h2>
            <span className="card__hint">next 8 with a due date</span>
          </header>
          {data.upcoming.length === 0 ? (
            <p className="hint">Nothing scheduled. Give a task a due date to see it here.</p>
          ) : (
            <ul className="task-rows">
              {data.upcoming.map((task) => (
                <li key={task.id}>
                  <Link to={`/p/${task.project.id}`} className="task-rows__link">
                    <span className="mono" style={{ color: task.project.color }}>
                      {task.project.key}-{task.number}
                    </span>
                    <span className="task-rows__title">{task.title}</span>
                    <PriorityBadge priority={task.priority} />
                    <span
                      className={`due ${isOverdue(task.dueDate, task.status.category) ? "due--late" : ""}`}
                    >
                      {dueLabel(task.dueDate)}
                    </span>
                    {task.assignee ? <Avatar user={task.assignee} size={24} /> : <span className="unassigned">—</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card card--wide">
          <header className="card__head">
            <h2>Reminders</h2>
            <span className="card__hint">your scheduled nudges</span>
          </header>
          {data.reminders.length === 0 ? (
            <p className="hint">No reminders set. Open a task and add one.</p>
          ) : (
            <ul className="reminder-list">
              {data.reminders.map((reminder) => {
                const late = new Date(reminder.remindAt) <= new Date();
                return (
                  <li key={reminder.id}>
                    <span className={`reminder-list__when ${late ? "due--late" : ""}`}>
                      {new Date(reminder.remindAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <Link to={`/p/${reminder.task.project.id}`} className="task-rows__link reminder-list__task">
                      <span className="mono" style={{ color: reminder.task.project.color }}>
                        {reminder.task.project.key}-{reminder.task.number}
                      </span>
                      <span className="task-rows__title">{reminder.task.title}</span>
                    </Link>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => {
                        void api.tasks.dismissReminder(reminder.id).then(() => {
                          setData((current) =>
                            current
                              ? {
                                  ...current,
                                  reminders: current.reminders.filter((entry) => entry.id !== reminder.id),
                                }
                              : current,
                          );
                        });
                      }}
                    >
                      Dismiss
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card card--wide">
          <header className="card__head">
            <h2>Activity</h2>
            <span className="card__hint">latest across the workspace</span>
          </header>
          {data.activity.length === 0 ? (
            <p className="hint">No activity yet.</p>
          ) : (
            <ul className="feed">
              {data.activity.map((entry) => (
                <li key={entry.id}>
                  <Avatar user={entry.actor} size={24} />
                  <p>
                    <strong>{entry.actor.name}</strong> {entry.message}
                  </p>
                  <time dateTime={entry.createdAt}>{timeAgo(entry.createdAt)}</time>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

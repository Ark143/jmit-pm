import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../api";
import { useLiveRefresh } from "../live";
import { Avatar, EmptyState, PriorityBadge, Spinner } from "../ui";
import type { WorkloadData, WorkspaceDetail } from "../types";

const SPANS = [7, 14, 30] as const;

/** Anything above 3 tasks on one day is "hot" — the colour scale tops out there. */
function loadLevel(value: number) {
  if (value <= 0) return 0;
  if (value <= 1) return 1;
  if (value <= 3) return 2;
  return 3;
}

export function WorkloadPage({ workspace }: { workspace: WorkspaceDetail }) {
  const [span, setSpan] = useState<(typeof SPANS)[number]>(14);
  const [data, setData] = useState<WorkloadData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await api.workspaces.workload(workspace.id, span));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the workload");
    }
  }, [workspace.id, span]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  useLiveRefresh(() => void load());

  if (error) {
    return <EmptyState title="Workload unavailable" body={error} />;
  }

  if (!data) return <Spinner label="Building the timeline…" />;

  const gridStyle = {
    gridTemplateColumns: `190px repeat(${data.range.days.length}, minmax(30px, 1fr))`,
  };

  const byMember = data.members
    .map((member) => ({
      member,
      tasks: data.assignments.filter((row) => row.assigneeId === member.user.id),
    }))
    .filter((row) => row.tasks.length > 0);

  return (
    <div className="page">
      <header className="page__head page__head--row">
        <div>
          <h1>Workload</h1>
          <p className="page__sub">
            Who is carrying what between {formatDay(data.range.start)} and {formatDay(data.range.end)}.
          </p>
        </div>
        <div className="view-switch" role="tablist" aria-label="Timeline length">
          {SPANS.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={span === option}
              className={span === option ? "is-active" : ""}
              onClick={() => setSpan(option)}
            >
              {option} days
            </button>
          ))}
        </div>
      </header>

      <section className="workload__legend">
        <span className="hint">Open tasks per day</span>
        <span className="workload__swatch" data-level="1" />
        <span className="hint">1</span>
        <span className="workload__swatch" data-level="2" />
        <span className="hint">2–3</span>
        <span className="workload__swatch" data-level="3" />
        <span className="hint">4+</span>
      </section>

      <section className="card workload">
        <div className="workload__scroll">
          <div className="workload__grid" style={gridStyle}>
            <div className="workload__corner">Person</div>
            {data.range.days.map((day) => {
              const date = new Date(`${day}T00:00:00`);
              const weekend = date.getDay() === 0 || date.getDay() === 6;
              const today = day === localDay(new Date());
              return (
                <div
                  key={day}
                  className={`workload__day ${weekend ? "is-weekend" : ""} ${today ? "is-today" : ""}`}
                >
                  <span>{date.toLocaleDateString(undefined, { weekday: "narrow" })}</span>
                  <strong>{date.getDate()}</strong>
                </div>
              );
            })}

            {data.members.map((member) => (
              <div className="workload__row" key={member.user.id} style={gridStyle}>
                <div className="workload__person">
                  <Avatar user={member.user} size={26} />
                  <span className="workload__name" title={member.user.email}>
                    {member.user.name}
                  </span>
                  <span className={`workload__total ${member.overdue ? "is-late" : ""}`}>
                    {member.overdue ? `${member.overdue} late` : `${member.total} slots`}
                  </span>
                </div>
                {member.load.map((value, index) => (
                  <div
                    key={index}
                    className="workload__cell"
                    data-level={loadLevel(value)}
                    title={`${value} open task${value === 1 ? "" : "s"}`}
                  >
                    {value > 0 ? value : ""}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {byMember.length === 0 ? (
        <EmptyState
          title="Nobody is booked"
          body="Open tasks with a start or due date inside this window show up here."
        />
      ) : (
        <div className="workload__groups">
          {byMember.map(({ member, tasks }) => (
            <section className="card" key={member.user.id}>
              <header className="card__head">
                <h2>
                  <Avatar user={member.user} size={22} /> {member.user.name}
                </h2>
                <span className="card__hint">
                  {tasks.length} task{tasks.length === 1 ? "" : "s"}
                  {member.overdue ? ` · ${member.overdue} overdue` : ""}
                </span>
              </header>
              <ul className="workload__tasks">
                {tasks.map((task) => (
                  <li key={task.id}>
                    <Link to={`/p/${task.project.id}?task=${task.id}`} className="workload__task">
                      <span className="mono" style={{ color: task.project.color }}>
                        {task.project.key}-{task.number}
                      </span>
                      <span className="workload__task-title">{task.title}</span>
                      <PriorityBadge priority={task.priority} />
                      <span className="hint">
                        {data.range.days[task.startDay]} → {data.range.days[task.endDay]}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function localDay(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatDay(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

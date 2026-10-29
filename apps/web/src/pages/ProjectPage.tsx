import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../api";
import { useAuth } from "../auth";
import {
  PRIORITY_META,
  addDays,
  dayDiff,
  daysUntil,
  dueLabel,
  isOverdue,
  monthMatrix,
  startOfDay,
  toDateInput,
} from "../lib";
import { useLiveRefresh } from "../live";
import { Avatar, EmptyState, Modal, PriorityBadge, Spinner } from "../ui";
import type {
  CustomFieldType,
  FilterPreset,
  Priority,
  ProjectDetail,
  Tag,
  TaskListItem,
  WorkspaceDetail,
} from "../types";
import { TaskPanel } from "./TaskPanel";

type View = "board" | "list" | "calendar" | "gantt" | "deadlines";

const VIEWS: Array<{ id: View; label: string }> = [
  { id: "board", label: "Board" },
  { id: "list", label: "List" },
  { id: "calendar", label: "Calendar" },
  { id: "gantt", label: "Gantt" },
  { id: "deadlines", label: "Deadlines" },
];

const PRIORITIES: Priority[] = ["URGENT", "HIGH", "MEDIUM", "LOW"];

const FIELD_TYPES: Array<{ id: CustomFieldType; label: string }> = [
  { id: "TEXT", label: "Text" },
  { id: "NUMBER", label: "Number" },
  { id: "DATE", label: "Date" },
  { id: "SELECT", label: "Dropdown" },
  { id: "CHECKBOX", label: "Checkbox" },
  { id: "URL", label: "Link" },
];

export function ProjectPage({
  workspace,
  onWorkspaceChange,
}: {
  workspace: WorkspaceDetail;
  onWorkspaceChange: () => void;
}) {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [tasks, setTasks] = useState<TaskListItem[] | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [fieldsOpen, setFieldsOpen] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("board");
  const [query, setQuery] = useState("");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState<"" | Priority>("");
  const [statusFilter, setStatusFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
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
      const detail = await api.projects.get(projectId);
      const [list, tagList, filterList] = await Promise.all([
        api.tasks.list(projectId),
        api.workspaces.tags(detail.workspaceId).catch(() => [] as Tag[]),
        api.workspaces.filters(detail.workspaceId, projectId).catch(() => [] as FilterPreset[]),
      ]);
      setProject(detail);
      setTasks(list);
      setTags(tagList);
      setPresets(filterList);
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
    setStatusFilter("");
    setTagFilter("");
    setActivePreset(null);
    void load();
  }, [load]);

  // Notification and search links carry the task to open.
  useEffect(() => {
    const linkedTask = searchParams.get("task");
    if (linkedTask) setOpenTaskId(linkedTask);
  }, [searchParams]);

  useLiveRefresh(() => void load());

  const filtered = useMemo(() => {
    if (!tasks) return [];
    const needle = query.trim().toLowerCase();
    return tasks.filter((task) => {
      if (assignee && task.assignee?.id !== assignee) return false;
      if (priority && task.priority !== priority) return false;
      if (statusFilter && task.statusId !== statusFilter) return false;
      if (tagFilter && !task.tags.some((tag) => tag.id === tagFilter)) return false;
      if (onlyMine && task.assignee?.id !== user?.id) return false;
      if (needle) {
        const haystack = `${task.number} ${task.title}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [tasks, query, assignee, priority, statusFilter, tagFilter, onlyMine, user?.id]);

  function clearPreset() {
    setActivePreset(null);
  }

  function applyPreset(preset: FilterPreset) {
    setActivePreset(preset.id);
    setQuery(preset.state.q ?? "");
    setAssignee(preset.state.assigneeId ?? "");
    setPriority(preset.state.priority ?? "");
    setStatusFilter(preset.state.statusId ?? "");
    const tag = tags.find((entry) => entry.name === preset.state.tag);
    setTagFilter(tag?.id ?? "");
    setOnlyMine(false);
  }

  async function savePreset() {
    if (!project || !presetName.trim()) return;
    try {
      const preset = await api.workspaces.createFilter(project.workspaceId, {
        name: presetName.trim(),
        projectId: project.id,
        state: {
          ...(query.trim() ? { q: query.trim() } : {}),
          ...(assignee ? { assigneeId: assignee } : {}),
          ...(priority ? { priority } : {}),
          ...(statusFilter ? { statusId: statusFilter } : {}),
          ...(tagFilter ? { tag: tags.find((tag) => tag.id === tagFilter)?.name ?? "" } : {}),
        },
      });
      setPresetName("");
      setActivePreset(preset.id);
      setPresets((current) => [...current, preset]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the filter");
    }
  }

  async function deletePreset(preset: FilterPreset) {
    try {
      await api.workspaces.removeFilter(preset.id);
      setPresets((current) => current.filter((entry) => entry.id !== preset.id));
      if (activePreset === preset.id) setActivePreset(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete the filter");
    }
  }

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

        <div className="head-actions">
          <button type="button" className="btn btn--sm" onClick={() => setFieldsOpen(true)}>
            Task fields
          </button>
          <div className="view-switch" role="tablist" aria-label="View">
            {VIEWS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={view === option.id}
                className={view === option.id ? "is-active" : ""}
                onClick={() => setView(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="preset-bar">
        <span className="preset-bar__label">Saved filters</span>
        {presets.map((preset) => (
          <span key={preset.id} className={`preset ${activePreset === preset.id ? "is-active" : ""}`}>
            <button type="button" onClick={() => applyPreset(preset)}>
              {preset.name}
            </button>
            <button
              type="button"
              className="preset__x"
              aria-label={`Delete saved filter ${preset.name}`}
              onClick={() => void deletePreset(preset)}
            >
              ×
            </button>
          </span>
        ))}
        {presets.length === 0 ? <span className="hint">None yet — set filters, then save them.</span> : null}
        <span className="preset-bar__spacer" />
        <input
          className="preset-bar__name"
          value={presetName}
          onChange={(event) => setPresetName(event.target.value)}
          placeholder="Name this filter"
          aria-label="Saved filter name"
        />
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => void savePreset()}
          disabled={!presetName.trim()}
        >
          Save filter
        </button>
      </div>

      <div className="filters">
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            clearPreset();
          }}
          placeholder="Search tasks…"
          aria-label="Search tasks"
        />
        <select
          value={statusFilter}
          onChange={(event) => {
            setStatusFilter(event.target.value);
            clearPreset();
          }}
          aria-label="Filter by status"
        >
          <option value="">Any status</option>
          {project.statuses.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </select>
        <select
          value={assignee}
          onChange={(event) => {
            setAssignee(event.target.value);
            clearPreset();
          }}
          aria-label="Filter by assignee"
        >
          <option value="">Anyone</option>
          {workspace.members.map((member) => (
            <option key={member.user.id} value={member.user.id}>
              {member.user.name}
            </option>
          ))}
        </select>
        <select
          value={priority}
          onChange={(event) => {
            setPriority(event.target.value as "" | Priority);
            clearPreset();
          }}
          aria-label="Filter by priority"
        >
          <option value="">Any priority</option>
          {PRIORITIES.map((value) => (
            <option key={value} value={value}>
              {value[0] + value.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
        <select
          value={tagFilter}
          onChange={(event) => {
            setTagFilter(event.target.value);
            clearPreset();
          }}
          aria-label="Filter by tag"
        >
          <option value="">Any tag</option>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </select>
        <label className="check">
          <input
            type="checkbox"
            checked={onlyMine}
            onChange={(event) => {
              setOnlyMine(event.target.checked);
              clearPreset();
            }}
          />
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
                        {task.tags.length > 0 ? (
                          <span className="task-card__tags">
                            {task.tags.slice(0, 3).map((tag) => (
                              <span
                                key={tag.id}
                                className="tag-dot"
                                title={tag.name}
                                style={{ background: tag.color }}
                              />
                            ))}
                          </span>
                        ) : null}
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
                          {task._count.attachments > 0 ? (
                            <span className="count" title={`${task._count.attachments} files`}>
                              📎 {task._count.attachments}
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
                <th scope="col">Planned</th>
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
                    <tr
                      key={task.id}
                      onClick={() => setOpenTaskId(task.id)}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") setOpenTaskId(task.id);
                      }}
                    >
                      <td className="mono">
                        {project.key}-{task.number}
                      </td>
                      <td className="table__title">
                        {task.title}
                        {task.tags.length > 0 ? (
                          <span className="inline-tags">
                            {task.tags.map((tag) => (
                              <span key={tag.id} className="inline-tag" style={{ color: tag.color }}>
                                #{tag.name}
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </td>
                      <td>{status?.name ?? "—"}</td>
                      <td>{task.assignee ? <Avatar user={task.assignee} size={22} /> : "—"}</td>
                      <td>
                        <PriorityBadge priority={task.priority} />
                      </td>
                      <td>{task.plannedMinutes ? `${task.plannedMinutes}m` : "—"}</td>
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

      {view === "gantt" ? (
        <GanttView tasks={filtered} projectKey={project.key} onOpen={(id) => setOpenTaskId(id)} />
      ) : null}

      {view === "deadlines" ? (
        <DeadlinesView tasks={filtered} projectKey={project.key} onOpen={(id) => setOpenTaskId(id)} />
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

      <FieldsModal
        open={fieldsOpen}
        project={project}
        onClose={() => setFieldsOpen(false)}
        onChanged={() => {
          void load();
          setFieldsOpen(false);
        }}
      />
    </div>
  );
}

/**
 * A task with only a due date still deserves a visible bar, so it is drawn as a
 * two-day band that ends on the due date. Same idea when only a start date exists.
 */
function barRange(task: TaskListItem): { start: Date; end: Date } {
  const due = task.dueDate ? startOfDay(new Date(task.dueDate)) : null;
  const start = task.startDate ? startOfDay(new Date(task.startDate)) : null;

  if (start && due) return due < start ? { start, end: start } : { start, end: due };
  if (start) return { start, end: addDays(start, 1) };
  const end = due as Date;
  return { start: addDays(end, -1), end };
}

function GanttView({
  tasks,
  projectKey,
  onOpen,
}: {
  tasks: TaskListItem[];
  projectKey: string;
  onOpen: (id: string) => void;
}) {
  const dated = tasks.filter((task) => task.startDate || task.dueDate);

  if (dated.length === 0) {
    return (
      <EmptyState
        title="Nothing to plot"
        body="Add a start date or due date to a task and it appears on the timeline."
      />
    );
  }

  const ranges = new Map(dated.map((task) => [task.id, barRange(task)]));
  const allRanges = [...ranges.values()];
  const min = addDays(new Date(Math.min(...allRanges.map((r) => r.start.getTime()))), -1);
  const rawMax = new Date(Math.max(...allRanges.map((r) => r.end.getTime())));
  const max = addDays(rawMax, 2);
  const totalDays = Math.min(120, Math.max(3, dayDiff(min, max) + 1));
  const todayIndex = dayDiff(min, new Date());

  const columns = { gridTemplateColumns: `220px repeat(${totalDays}, minmax(28px, 1fr))` };

  return (
    <div className="gantt">
      <div className="gantt__scroll">
        <div className="gantt__grid" style={columns}>
          <div className="gantt__corner">Task</div>
          {Array.from({ length: totalDays }, (_, index) => {
            const date = addDays(min, index);
            const isToday = index === todayIndex;
            return (
              <div key={index} className={`gantt__day ${isToday ? "is-today" : ""}`}>
                <span>
                  {date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              </div>
            );
          })}

          {dated.map((task) => {
            const range = ranges.get(task.id) as { start: Date; end: Date };
            const from = Math.max(1, dayDiff(min, range.start) + 1);
            const to = Math.min(totalDays, Math.max(from, dayDiff(min, range.end) + 1));
            const tag = task.tags[0];

            return (
              <div className="gantt__row" key={task.id} style={columns}>
                <button
                  type="button"
                  className="gantt__label"
                  onClick={() => onOpen(task.id)}
                  title={task.title}
                >
                  <span className="mono">
                    {projectKey}-{task.number}
                  </span>
                  <span className="gantt__title">{task.title}</span>
                </button>
                <button
                  type="button"
                  className={`gantt__bar ${isOverdue(task.dueDate) ? "is-late" : ""}`}
                  style={{
                    gridColumn: `${from + 1} / ${to + 2}`,
                    background: `${PRIORITY_META[task.priority].color}33`,
                    borderColor: PRIORITY_META[task.priority].color,
                  }}
                  onClick={() => onOpen(task.id)}
                  title={`${task.title}${tag ? ` · #${tag.name}` : ""}`}
                >
                  <span
                    className="gantt__bar-fill"
                    style={{ background: PRIORITY_META[task.priority].color }}
                  />
                  <span className="gantt__bar-text">{task.title}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <p className="hint">
        Bars run from start date to due date. Drag-free by design: change the dates in the task to move
        them.
      </p>
    </div>
  );
}

function DeadlinesView({
  tasks,
  projectKey,
  onOpen,
}: {
  tasks: TaskListItem[];
  projectKey: string;
  onOpen: (id: string) => void;
}) {
  const withDates = tasks.filter((task) => task.dueDate);
  const buckets = [
    {
      id: "overdue",
      label: "Overdue",
      match: (task: TaskListItem) => {
        const diff = daysUntil(task.dueDate);
        return diff !== null && diff < 0;
      },
    },
    {
      id: "today",
      label: "Today",
      match: (task: TaskListItem) => daysUntil(task.dueDate) === 0,
    },
    {
      id: "week",
      label: "Next 7 days",
      match: (task: TaskListItem) => {
        const diff = daysUntil(task.dueDate);
        return diff !== null && diff > 0 && diff <= 7;
      },
    },
    {
      id: "later",
      label: "Later",
      match: (task: TaskListItem) => {
        const diff = daysUntil(task.dueDate);
        return diff !== null && diff > 7;
      },
    },
  ];

  if (withDates.length === 0) {
    return (
      <EmptyState
        title="No deadlines yet"
        body="Set a due date on a task and it lands here, grouped by how close it is."
      />
    );
  }

  return (
    <div className="deadlines">
      {buckets.map((bucket) => {
        const items = withDates
          .filter((task) => bucket.match(task))
          .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
        if (items.length === 0) return null;

        return (
          <section key={bucket.id} className={`deadline-group deadline-group--${bucket.id}`}>
            <header>
              <h2>{bucket.label}</h2>
              <span className="pill">{items.length}</span>
            </header>
            <ul>
              {items.map((task) => (
                <li key={task.id}>
                  <button type="button" className="deadline-row" onClick={() => onOpen(task.id)}>
                    <span className="mono">{projectKey}-{task.number}</span>
                    <span className="deadline-row__title">{task.title}</span>
                    <PriorityBadge priority={task.priority} />
                    <span className={`due ${isOverdue(task.dueDate) ? "due--late" : ""}`}>
                      {toDateInput(task.dueDate)} · {dueLabel(task.dueDate)}
                    </span>
                    {task.assignee ? <Avatar user={task.assignee} size={22} /> : <span className="unassigned">—</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

    </div>
  );
}

function FieldsModal({
  open,
  project,
  onClose,
  onChanged,
}: {
  open: boolean;
  project: ProjectDetail;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<CustomFieldType>("TEXT");
  const [options, setOptions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setType("TEXT");
      setOptions("");
      setError(null);
    }
  }, [open]);

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.projects.addField(project.id, {
        name: name.trim(),
        type,
        options:
          type === "SELECT"
            ? options
                .split(",")
                .map((option) => option.trim())
                .filter(Boolean)
            : undefined,
      });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add the field");
    } finally {
      setBusy(false);
    }
  }

  async function remove(fieldId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.projects.removeField(fieldId);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove the field");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Task fields" width={520}>
      <p className="hint">
        Custom fields belong to this project. They show up on every task in it.
      </p>

      <ul className="field-list">
        {project.customFields.map((field) => (
          <li key={field.id}>
            <strong>{field.name}</strong>
            <span className="hint">{FIELD_TYPES.find((entry) => entry.id === field.type)?.label}</span>
            {field.type === "SELECT" ? (
              <span className="hint">{field.options.join(", ")}</span>
            ) : null}
            <button
              type="button"
              className="icon-btn icon-btn--sm"
              onClick={() => void remove(field.id)}
              disabled={busy}
              aria-label={`Delete field ${field.name}`}
            >
              ✕
            </button>
          </li>
        ))}
        {project.customFields.length === 0 ? <li className="hint">No custom fields yet.</li> : null}
      </ul>

      <form className="stack" onSubmit={add}>
        <label className="field field--tight">
          <span>Field name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Budget code" />
        </label>
        <label className="field field--tight">
          <span>Type</span>
          <select value={type} onChange={(event) => setType(event.target.value as CustomFieldType)}>
            {FIELD_TYPES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        {type === "SELECT" ? (
          <label className="field field--tight">
            <span>Options (comma separated)</span>
            <input
              value={options}
              onChange={(event) => setOptions(event.target.value)}
              placeholder="Design, Build, Review"
            />
          </label>
        ) : null}
        <div className="row row--end">
          <button type="button" className="btn btn--sm" onClick={onClose}>
            Close
          </button>
          <button type="submit" className="btn btn--sm btn--primary" disabled={busy || !name.trim()}>
            Add field
          </button>
        </div>
      </form>

      {error ? <p className="error-note">{error}</p> : null}
    </Modal>
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
                      <span className="mono">
                        {projectKey}-{task.number}
                      </span>{" "}
                      {task.title}
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

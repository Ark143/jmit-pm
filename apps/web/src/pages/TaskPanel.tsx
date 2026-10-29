import { useCallback, useEffect, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { ApiError, api } from "../api";
import { dueLabel, fmtBytes, fmtMinutes, isOverdue, timeLabel, toDateInput } from "../lib";
import { Avatar, ErrorNote, PriorityBadge, Spinner } from "../ui";
import type {
  Checklist,
  ChecklistItem,
  CustomField,
  Member,
  Priority,
  RecurrenceRule,
  Status,
  TaskDetail,
  TaskHistoryEntry,
  TaskListItem,
} from "../types";

const RECURRENCE_LABEL: Record<RecurrenceRule, string> = {
  DAILY: "Every day",
  WEEKLY: "Every week",
  MONTHLY: "Every month",
};

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
  const [projectTasks, setProjectTasks] = useState<TaskListItem[]>([]);
  const [history, setHistory] = useState<TaskHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [planned, setPlanned] = useState("");
  const [comment, setComment] = useState("");
  const [subtask, setSubtask] = useState("");
  const [minutes, setMinutes] = useState("30");
  const [note, setNote] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [checklistDraft, setChecklistDraft] = useState("");
  const [itemDrafts, setItemDrafts] = useState<Record<string, string>>({});
  const [observerPick, setObserverPick] = useState("");
  const [reminderAt, setReminderAt] = useState("");
  const [dependencyPick, setDependencyPick] = useState("");
  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRule>("WEEKLY");
  const [recurrenceInterval, setRecurrenceInterval] = useState("1");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!taskId) return;
    try {
      setError(null);
      const detail = await api.tasks.get(taskId);
      setTask(detail);
      setTitle(detail.title);
      setDescription(detail.description ?? "");
      setPlanned(detail.plannedMinutes === null ? "" : String(detail.plannedMinutes));
      setRecurrenceRule(detail.recurrence?.rule ?? "WEEKLY");
      setRecurrenceInterval(String(detail.recurrence?.interval ?? 1));
      const [project, siblings, log] = await Promise.all([
        api.projects.get(detail.project.id),
        api.tasks.list(detail.project.id),
        api.tasks.history(taskId).catch(() => [] as TaskHistoryEntry[]),
      ]);
      setStatuses(project.statuses);
      setProjectTasks(siblings);
      setHistory(log);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the task");
    }
  }, [taskId]);

  useEffect(() => {
    setTask(null);
    setError(null);
    setHistory([]);
    setTagInput("");
    setChecklistDraft("");
    setItemDrafts({});
    setObserverPick("");
    setReminderAt("");
    setDependencyPick("");
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!taskId) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [taskId, onClose]);

  if (!taskId) return null;

  async function run(action: () => Promise<unknown>, fallback = "Could not save") {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  async function patch(body: Parameters<typeof api.tasks.update>[1]) {
    await run(() => api.tasks.update(taskId as string, body));
  }

  async function addComment(event: FormEvent) {
    event.preventDefault();
    if (!comment.trim()) return;
    const body = comment.trim();
    setComment("");
    await run(() => api.tasks.comment(taskId as string, body), "Could not post the comment");
  }

  async function addSubtask(event: FormEvent) {
    event.preventDefault();
    if (!task || !subtask.trim()) return;
    const value = subtask.trim();
    setSubtask("");
    await run(
      () =>
        api.tasks.create(task.project.id, {
          title: value,
          parentId: task.id,
          statusId: task.statusId,
          assigneeId: task.assignee?.id ?? null,
        }),
      "Could not add the subtask",
    );
  }

  async function logTime(event: FormEvent) {
    event.preventDefault();
    const value = Number(minutes);
    if (!Number.isFinite(value) || value <= 0) return;
    await run(async () => {
      await api.tasks.logTime(taskId as string, {
        minutes: Math.round(value),
        note: note || undefined,
      });
      setNote("");
    }, "Could not log time");
  }

  async function remove() {
    if (!window.confirm("Delete this task and its subtasks?")) return;
    try {
      await api.tasks.remove(taskId as string);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete the task");
    }
  }

  async function commitTag(raw?: string) {
    if (!task) return;
    const name = (raw ?? tagInput).trim().replace(/,$/, "");
    if (!name) return;
    if (task.tags.some((tag) => tag.name.toLowerCase() === name.toLowerCase())) {
      setTagInput("");
      return;
    }
    setTagInput("");
    await run(
      () => api.tasks.setTags(task.id, [...task.tags.map((tag) => tag.name), name]),
      "Could not add the tag",
    );
  }

  async function removeTag(name: string) {
    if (!task) return;
    await run(
      () => api.tasks.setTags(task.id, task.tags.filter((tag) => tag.name !== name).map((tag) => tag.name)),
      "Could not remove the tag",
    );
  }

  async function addChecklist(event: FormEvent) {
    event.preventDefault();
    if (!checklistDraft.trim()) return;
    const value = checklistDraft.trim();
    setChecklistDraft("");
    await run(() => api.tasks.addChecklist(taskId as string, value), "Could not add the checklist");
  }

  async function addItem(event: FormEvent, checklist: Checklist) {
    event.preventDefault();
    const value = (itemDrafts[checklist.id] ?? "").trim();
    if (!value) return;
    setItemDrafts((current) => ({ ...current, [checklist.id]: "" }));
    await run(() => api.tasks.addChecklistItem(checklist.id, { text: value }), "Could not add the item");
  }

  async function addObserver(event: FormEvent) {
    event.preventDefault();
    if (!observerPick) return;
    const userId = observerPick;
    setObserverPick("");
    await run(() => api.tasks.addObserver(taskId as string, userId), "Could not add the observer");
  }

  async function addReminder(event: FormEvent) {
    event.preventDefault();
    if (!reminderAt) return;
    const value = new Date(reminderAt);
    setReminderAt("");
    await run(
      () => api.tasks.addReminder(taskId as string, value.toISOString()),
      "Could not set the reminder",
    );
  }

  async function addDependency(event: FormEvent) {
    event.preventDefault();
    if (!dependencyPick) return;
    const dependsOnId = dependencyPick;
    setDependencyPick("");
    await run(
      () => api.tasks.addDependency(taskId as string, dependsOnId),
      "Could not link the task",
    );
  }

  async function saveRecurrence(event: FormEvent) {
    event.preventDefault();
    const interval = Math.max(1, Math.min(52, Math.round(Number(recurrenceInterval) || 1)));
    await run(
      () => api.tasks.setRecurrence(taskId as string, { rule: recurrenceRule, interval }),
      "Could not save the repeat rule",
    );
  }

  const observers = task?.observers ?? [];
  const observingIds = new Set(observers.map((person) => person.id));
  const blockedIds = new Set((task?.blockedBy ?? []).map((link) => link.task.id));
  const blockedByMeIds = new Set((task?.blocks ?? []).map((link) => link.task.id));

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
          <div className="drawer__loading">
            {error ? <ErrorNote message={error} /> : <Spinner label="Loading task…" />}
          </div>
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
                  <span>Start date</span>
                  <input
                    type="date"
                    value={toDateInput(task.startDate)}
                    onChange={(event) =>
                      void patch({
                        startDate: event.target.value
                          ? new Date(event.target.value).toISOString()
                          : null,
                      })
                    }
                  />
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
                  <span>Planned (minutes)</span>
                  <input
                    type="number"
                    min={0}
                    step={15}
                    value={planned}
                    onChange={(event) => setPlanned(event.target.value)}
                    onBlur={() => {
                      const next = planned === "" ? null : Math.max(0, Math.round(Number(planned)));
                      if (next !== task.plannedMinutes) void patch({ plannedMinutes: next });
                    }}
                  />
                </label>

                <div className="field field--tight">
                  <span>Time</span>
                  <p className="meta-value">
                    {timeLabel(task.plannedMinutes, task.loggedMinutes)}
                    {task.plannedMinutes && task.loggedMinutes > task.plannedMinutes ? (
                      <em className="over-budget"> · over plan</em>
                    ) : null}
                  </p>
                </div>
              </div>

              <section className="drawer__section">
                <h3>Tags</h3>
                <div className="chip-row">
                  {task.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="chip"
                      style={{ borderColor: `${tag.color}66`, background: `${tag.color}1a` }}
                    >
                      <span className="dot" style={{ background: tag.color }} />
                      {tag.name}
                      <button
                        type="button"
                        className="chip__x"
                        aria-label={`Remove tag ${tag.name}`}
                        onClick={() => void removeTag(tag.name)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    className="chip-input"
                    value={tagInput}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value.endsWith(",")) void commitTag(value);
                      else setTagInput(value);
                    }}
                    onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void commitTag();
                      }
                    }}
                    onBlur={() => void commitTag()}
                    placeholder={task.tags.length ? "Add tag…" : "Add a tag and press Enter"}
                    aria-label="Add tag"
                  />
                </div>
              </section>

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

              {task.customFields.length > 0 ? (
                <section className="drawer__section">
                  <h3>Custom fields</h3>
                  <div className="meta-grid">
                    {task.customFields.map((field) => (
                      <CustomValueField
                        key={field.id}
                        field={field}
                        value={task.customValues.find((v) => v.fieldId === field.id)?.value ?? null}
                        onSave={(value) =>
                          run(
                            () => api.tasks.setCustomValue(task.id, field.id, value),
                            "Could not save the field",
                          )
                        }
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="drawer__section">
                <h3>
                  Checklists{" "}
                  <span className="pill">
                    {task.checklists.reduce(
                      (sum, list) => sum + list.items.filter((item) => item.done).length,
                      0,
                    )}
                    /
                    {task.checklists.reduce((sum, list) => sum + list.items.length, 0)}
                  </span>
                </h3>

                {task.checklists.map((checklist) => (
                  <div key={checklist.id} className="checklist">
                    <header className="checklist__head">
                      <strong>{checklist.title}</strong>
                      <span className="hint">
                        {checklist.items.filter((item) => item.done).length}/{checklist.items.length}
                      </span>
                      <button
                        type="button"
                        className="icon-btn icon-btn--sm"
                        aria-label={`Delete checklist ${checklist.title}`}
                        onClick={() =>
                          void run(
                            () => api.tasks.removeChecklist(checklist.id),
                            "Could not remove the checklist",
                          )
                        }
                      >
                        ✕
                      </button>
                    </header>

                    <ul className="checklist__items">
                      {checklist.items.map((item) => (
                        <ChecklistRow
                          key={item.id}
                          item={item}
                          members={members}
                          onToggle={(done) => {
                            // Flip it locally first so a slow round-trip never looks broken.
                            setTask((current) =>
                              current
                                ? {
                                    ...current,
                                    checklists: current.checklists.map((list) => ({
                                      ...list,
                                      items: list.items.map((entry) =>
                                        entry.id === item.id ? { ...entry, done } : entry,
                                      ),
                                    })),
                                  }
                                : current,
                            );
                            void run(
                              () => api.tasks.updateChecklistItem(item.id, { done }),
                              "Could not update the item",
                            );
                          }}
                          onAssign={(assigneeId) =>
                            run(
                              () => api.tasks.updateChecklistItem(item.id, { assigneeId }),
                              "Could not assign the item",
                            )
                          }
                          onDue={(dueDate) =>
                            run(
                              () => api.tasks.updateChecklistItem(item.id, { dueDate }),
                              "Could not set the date",
                            )
                          }
                          onRemove={() =>
                            run(
                              () => api.tasks.removeChecklistItem(item.id),
                              "Could not remove the item",
                            )
                          }
                        />
                      ))}
                    </ul>

                    <form className="inline-form" onSubmit={(event) => void addItem(event, checklist)}>
                      <input
                        value={itemDrafts[checklist.id] ?? ""}
                        onChange={(event) =>
                          setItemDrafts((current) => ({
                            ...current,
                            [checklist.id]: event.target.value,
                          }))
                        }
                        placeholder="Add an item…"
                      />
                      <button
                        type="submit"
                        className="btn btn--sm"
                        disabled={!(itemDrafts[checklist.id] ?? "").trim()}
                      >
                        Add
                      </button>
                    </form>
                  </div>
                ))}

                <form className="inline-form" onSubmit={addChecklist}>
                  <input
                    value={checklistDraft}
                    onChange={(event) => setChecklistDraft(event.target.value)}
                    placeholder="New checklist name…"
                  />
                  <button type="submit" className="btn btn--sm" disabled={!checklistDraft.trim()}>
                    Add checklist
                  </button>
                </form>
              </section>

              <section className="drawer__section">
                <h3>Related tasks</h3>
                <div className="link-group">
                  <span className="link-group__label">Blocked by</span>
                  <ul className="linked">
                    {task.blockedBy.map((link) => (
                      <li key={link.id}>
                        <span className="mono">
                          {task.project.key}-{link.task.number}
                        </span>
                        <span className="linked__title">{link.task.title}</span>
                        <span className={`badge badge--plain`}>{link.task.status.name}</span>
                        <button
                          type="button"
                          className="icon-btn icon-btn--sm"
                          aria-label="Remove dependency"
                          onClick={() =>
                            void run(
                              () => api.tasks.removeDependency(task.id, link.id),
                              "Could not unlink the task",
                            )
                          }
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                    {task.blockedBy.length === 0 ? <li className="hint">Nothing blocks this task.</li> : null}
                  </ul>
                  <form className="inline-form" onSubmit={addDependency}>
                    <select value={dependencyPick} onChange={(event) => setDependencyPick(event.target.value)}>
                      <option value="">Add a blocking task…</option>
                      {projectTasks
                        .filter(
                          (candidate) =>
                            candidate.id !== task.id &&
                            !blockedIds.has(candidate.id) &&
                            !blockedByMeIds.has(candidate.id),
                        )
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {task.project.key}-{candidate.number} · {candidate.title}
                          </option>
                        ))}
                    </select>
                    <button type="submit" className="btn btn--sm" disabled={!dependencyPick}>
                      Block on it
                    </button>
                  </form>
                </div>

                {task.blocks.length > 0 ? (
                  <div className="link-group">
                    <span className="link-group__label">Blocking</span>
                    <ul className="linked">
                      {task.blocks.map((link) => (
                        <li key={link.id}>
                          <span className="mono">
                            {task.project.key}-{link.task.number}
                          </span>
                          <span className="linked__title">{link.task.title}</span>
                          <span className="badge badge--plain">{link.task.status.name}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>

              <section className="drawer__section">
                <h3>Repeat</h3>
                {task.recurrence ? (
                  <div className="recurrence">
                    <p>
                      {RECURRENCE_LABEL[task.recurrence.rule]} · every {task.recurrence.interval}{" "}
                      {task.recurrence.rule === "DAILY" ? "day" : task.recurrence.rule === "WEEKLY" ? "week" : "month"}
                      {task.recurrence.interval === 1 ? "" : "s"}
                    </p>
                    <p className="hint">A fresh copy is created when this one is completed.</p>
                    <button
                      type="button"
                      className="btn btn--sm btn--danger"
                      onClick={() =>
                        void run(() => api.tasks.clearRecurrence(task.id), "Could not stop the repeat")
                      }
                    >
                      Stop repeating
                    </button>
                  </div>
                ) : (
                  <form className="inline-form" onSubmit={saveRecurrence}>
                    <select
                      value={recurrenceRule}
                      onChange={(event) => setRecurrenceRule(event.target.value as RecurrenceRule)}
                      aria-label="Repeat rule"
                    >
                      <option value="DAILY">Daily</option>
                      <option value="WEEKLY">Weekly</option>
                      <option value="MONTHLY">Monthly</option>
                    </select>
                    <input
                      type="number"
                      min={1}
                      max={52}
                      value={recurrenceInterval}
                      onChange={(event) => setRecurrenceInterval(event.target.value)}
                      aria-label="Repeat interval"
                      className="input--narrow"
                    />
                    <button type="submit" className="btn btn--sm">
                      Repeat
                    </button>
                  </form>
                )}
              </section>

              <section className="drawer__section">
                <h3>
                  Observers <span className="pill">{observers.length}</span>
                </h3>
                <div className="chip-row">
                  {observers.map((person) => (
                    <span key={person.id} className="chip chip--person">
                      <Avatar user={person} size={18} />
                      {person.name}
                      <button
                        type="button"
                        className="chip__x"
                        aria-label={`Remove observer ${person.name}`}
                        onClick={() =>
                          void run(
                            () => api.tasks.removeObserver(task.id, person.id),
                            "Could not remove the observer",
                          )
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {observers.length === 0 ? <span className="hint">No observers yet.</span> : null}
                </div>
                <form className="inline-form" onSubmit={addObserver}>
                  <select value={observerPick} onChange={(event) => setObserverPick(event.target.value)}>
                    <option value="">Add an observer…</option>
                    {members
                      .filter((member) => !observingIds.has(member.user.id))
                      .map((member) => (
                        <option key={member.user.id} value={member.user.id}>
                          {member.user.name}
                        </option>
                      ))}
                  </select>
                  <button type="submit" className="btn btn--sm" disabled={!observerPick}>
                    Add
                  </button>
                </form>
              </section>

              <section className="drawer__section">
                <h3>Reminders</h3>
                <ul className="reminders">
                  {task.reminders.map((reminder) => (
                    <li key={reminder.id}>
                      <span className={new Date(reminder.remindAt) < new Date() ? "due--late" : ""}>
                        {new Date(reminder.remindAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <button
                        type="button"
                        className="icon-btn icon-btn--sm"
                        aria-label="Delete reminder"
                        onClick={() =>
                          void run(
                            () => api.tasks.removeReminder(reminder.id),
                            "Could not delete the reminder",
                          )
                        }
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                  {task.reminders.length === 0 ? <li className="hint">No reminders.</li> : null}
                </ul>
                <form className="inline-form" onSubmit={addReminder}>
                  <input
                    type="datetime-local"
                    value={reminderAt}
                    onChange={(event) => setReminderAt(event.target.value)}
                    aria-label="Remind me at"
                  />
                  <button type="submit" className="btn btn--sm" disabled={!reminderAt}>
                    Remind me
                  </button>
                </form>
              </section>

              <section className="drawer__section">
                <h3>
                  Files <span className="pill">{task.attachments.length}</span>
                </h3>
                <ul className="files">
                  {task.attachments.map((file) => (
                    <li key={file.id}>
                      <button
                        type="button"
                        className="files__name"
                        onClick={() =>
                          void api.tasks
                            .downloadAttachment(file)
                            .catch((err: unknown) =>
                              setError(err instanceof ApiError ? err.message : "Download failed"),
                            )
                        }
                      >
                        {file.name}
                      </button>
                      <span className="hint">{fmtBytes(file.size)}</span>
                      <button
                        type="button"
                        className="icon-btn icon-btn--sm"
                        aria-label={`Delete ${file.name}`}
                        onClick={() =>
                          void run(
                            () => api.tasks.removeAttachment(file.id),
                            "Could not delete the file",
                          )
                        }
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                  {task.attachments.length === 0 ? <li className="hint">No files attached.</li> : null}
                </ul>
                <label className="btn btn--sm file-pick">
                  Attach a file (max 5 MB)
                  <input
                    type="file"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) return;
                      if (file.size > 5 * 1024 * 1024) {
                        setError("Files must be 5 MB or smaller");
                        return;
                      }
                      void run(
                        () => api.tasks.uploadAttachment(task.id, file),
                        "Could not upload the file",
                      );
                    }}
                  />
                </label>
              </section>

              <section className="drawer__section">
                <h3>
                  Subtasks <span className="pill">{task.subtasks.length}</span>
                </h3>
                <ul className="subtasks">
                  {task.subtasks.map((item) => (
                    <li key={item.id}>
                      <span className="subtask__title">{item.title}</span>
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
                  History <span className="pill">{history.length}</span>
                </h3>
                {history.length === 0 ? (
                  <p className="hint">No changes recorded yet.</p>
                ) : (
                  <ul className="history">
                    {history.map((entry) => (
                      <li key={entry.id}>
                        <Avatar user={entry.actor} size={20} />
                        <p>
                          <strong>{entry.actor.name}</strong> {entry.message}
                        </p>
                        <time dateTime={entry.createdAt}>
                          {new Date(entry.createdAt).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      </li>
                    ))}
                  </ul>
                )}
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
                        onClick={() =>
                          void run(
                            () => api.tasks.removeComment(entry.id),
                            "Could not delete the comment",
                          )
                        }
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
                {task.plannedMinutes ? ` · planned ${fmtMinutes(task.plannedMinutes)}` : ""}
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

function ChecklistRow({
  item,
  members,
  onToggle,
  onAssign,
  onDue,
  onRemove,
}: {
  item: ChecklistItem;
  members: Member[];
  onToggle: (done: boolean) => void;
  onAssign: (assigneeId: string | null) => void;
  onDue: (dueDate: string | null) => void;
  onRemove: () => void;
}) {
  return (
    <li className={`checklist__item ${item.done ? "is-done" : ""}`}>
      <input
        type="checkbox"
        checked={item.done}
        onChange={(event) => onToggle(event.target.checked)}
        aria-label={`Mark ${item.text} ${item.done ? "not done" : "done"}`}
      />
      <span className="checklist__text">{item.text}</span>
      <select
        value={item.assigneeId ?? ""}
        onChange={(event) => onAssign(event.target.value || null)}
        aria-label={`Assignee for ${item.text}`}
        className="checklist__who"
      >
        <option value="">Anyone</option>
        {members.map((member) => (
          <option key={member.user.id} value={member.user.id}>
            {member.user.name}
          </option>
        ))}
      </select>
      <input
        type="date"
        value={toDateInput(item.dueDate)}
        onChange={(event) =>
          onDue(event.target.value ? new Date(event.target.value).toISOString() : null)
        }
        aria-label={`Due date for ${item.text}`}
        className="checklist__due"
      />
      <button
        type="button"
        className="icon-btn icon-btn--sm"
        onClick={onRemove}
        aria-label={`Delete ${item.text}`}
      >
        ✕
      </button>
    </li>
  );
}

function CustomValueField({
  field,
  value,
  onSave,
}: {
  field: CustomField;
  value: string | null;
  onSave: (value: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value, field.id]);

  function commit(next: string) {
    if (next === (value ?? "")) return;
    onSave(next === "" ? null : next);
  }

  if (field.type === "CHECKBOX") {
    return (
      <label className="field field--tight">
        <span>{field.name}</span>
        <label className="check">
          <input
            type="checkbox"
            checked={value === "true"}
            onChange={(event) => onSave(event.target.checked ? "true" : null)}
          />
          Yes
        </label>
      </label>
    );
  }

  if (field.type === "SELECT") {
    return (
      <label className="field field--tight">
        <span>{field.name}</span>
        <select value={value ?? ""} onChange={(event) => onSave(event.target.value || null)}>
          <option value="">—</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  const inputType = field.type === "NUMBER" ? "number" : field.type === "DATE" ? "date" : field.type === "URL" ? "url" : "text";

  return (
    <label className="field field--tight">
      <span>{field.name}</span>
      <input
        type={inputType}
        value={field.type === "DATE" ? draft.slice(0, 10) : draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commit(field.type === "DATE" ? draft.slice(0, 10) : draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(field.type === "DATE" ? draft.slice(0, 10) : draft);
          }
        }}
        placeholder={field.type === "URL" ? "https://…" : "—"}
      />
    </label>
  );
}

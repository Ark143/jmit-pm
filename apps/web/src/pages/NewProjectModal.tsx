import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, api } from "../api";
import { ErrorNote, Modal } from "../ui";
import type { ProjectTemplate, ProjectVisibility } from "../types";

export function NewProjectModal({
  open,
  workspaceId,
  memberCount,
  onClose,
  onCreated,
}: {
  open: boolean;
  workspaceId: string | null;
  memberCount: number;
  onClose: () => void;
  onCreated: (projectId: string) => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [color, setColor] = useState("#4f8cff");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<ProjectVisibility>("WORKSPACE");
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !workspaceId) return;
    setError(null);
    api.projects
      .templates(workspaceId)
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, [open, workspaceId]);

  function reset() {
    setName("");
    setKey("");
    setDescription("");
    setColor("#4f8cff");
    setVisibility("WORKSPACE");
    setTemplateId("");
    setError(null);
  }

  const picked = templates.find((template) => template.id === templateId) ?? null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!workspaceId) return;

    setBusy(true);
    setError(null);
    try {
      const project = await api.projects.create(workspaceId, {
        name,
        key: key || name.slice(0, 3).toUpperCase(),
        color,
        description: description || undefined,
        visibility,
        templateId: templateId || undefined,
      });
      reset();
      onClose();
      await onCreated(project.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the project");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New project">
      <form className="stack" onSubmit={onSubmit}>
        {templates.length > 0 ? (
          <label className="field">
            <span>Start from</span>
            <select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
              <option value="">Blank project</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                  {template.blueprint.tasks?.length
                    ? ` · ${template.blueprint.tasks.length} tasks`
                    : ""}
                </option>
              ))}
            </select>
            {picked ? (
              <small className="hint">
                {picked.description ||
                  `Copies ${picked.blueprint.statuses?.length ?? 0} columns, ${
                    picked.blueprint.customFields?.length ?? 0
                  } custom fields and ${picked.blueprint.tasks?.length ?? 0} tasks.`}
              </small>
            ) : null}
          </label>
        ) : null}

        <label className="field">
          <span>Name</span>
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (!key) setKey(event.target.value.slice(0, 3).toUpperCase());
            }}
            required
            minLength={2}
            placeholder="Website launch"
          />
        </label>

        <div className="row">
          <label className="field">
            <span>Key</span>
            <input
              value={key}
              onChange={(event) => setKey(event.target.value.toUpperCase().slice(0, 6))}
              required
              minLength={2}
              maxLength={6}
              placeholder="WEB"
            />
          </label>
          <label className="field field--color">
            <span>Colour</span>
            <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
          </label>
        </div>

        <label className="field">
          <span>Description (optional)</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={500}
            placeholder="What is this project about?"
          />
        </label>

        <label className="field">
          <span>Who can open it</span>
          <select
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as ProjectVisibility)}
          >
            <option value="WORKSPACE">Everyone in this workspace</option>
            <option value="PRIVATE">Only me and people I add later</option>
          </select>
          <small className="hint">
            {visibility === "PRIVATE"
              ? "It starts with just you on the guest list; add the team from project settings."
              : `${memberCount} workspace ${memberCount === 1 ? "member sees" : "members see"} it.`}
          </small>
        </label>

        <ErrorNote message={error} />

        <div className="modal__foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "Creating…" : "Create project"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

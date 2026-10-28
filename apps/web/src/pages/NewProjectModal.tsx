import { useState } from "react";
import type { FormEvent } from "react";
import { ApiError, api } from "../api";
import { ErrorNote, Modal } from "../ui";

export function NewProjectModal({
  open,
  workspaceId,
  onClose,
  onCreated,
}: {
  open: boolean;
  workspaceId: string | null;
  onClose: () => void;
  onCreated: (projectId: string) => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [color, setColor] = useState("#4f8cff");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setName("");
    setKey("");
    setDescription("");
    setColor("#4f8cff");
    setError(null);
  }

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

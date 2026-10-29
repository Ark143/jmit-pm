import { useEffect, useState } from "react";
import { ApiError, api } from "../api";
import { EmptyState, ErrorNote, Modal, Spinner } from "../ui";
import type { ArchivedProject } from "../types";

/**
 * Archiving is reversible, so admins get a place to find what they filed away.
 * Only reachable for OWNER/ADMIN — the API enforces the same rule.
 */
export function ArchivedProjectsModal({
  open,
  workspaceId,
  onClose,
  onRestored,
}: {
  open: boolean;
  workspaceId: string | null;
  onClose: () => void;
  onRestored: () => Promise<void> | void;
}) {
  const [items, setItems] = useState<ArchivedProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !workspaceId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    api.workspaces
      .archived(workspaceId)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not load archived projects");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, workspaceId]);

  async function restore(project: ArchivedProject) {
    setBusyId(project.id);
    setError(null);
    try {
      await api.projects.restore(project.id);
      setItems((rows) => rows.filter((row) => row.id !== project.id));
      await onRestored();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not restore that project");
    } finally {
      setBusyId(null);
    }
  }

  async function purge(project: ArchivedProject) {
    const confirmed = window.confirm(
      `Permanently delete "${project.name}"? Its ${project._count.tasks} task(s), comments, and time logs go with it. This cannot be undone.`,
    );
    if (!confirmed) return;

    setBusyId(project.id);
    setError(null);
    try {
      await api.projects.purge(project.id);
      setItems((rows) => rows.filter((row) => row.id !== project.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete that project");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Archived projects" width={520}>
      <p className="modal__hint">
        Archived projects are hidden from the sidebar but keep every task, comment, and time log.
        Restoring puts one straight back.
      </p>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner label="Loading archived projects…" />
      ) : items.length === 0 ? (
        <EmptyState title="Nothing archived" body="Projects you archive will show up here." />
      ) : (
        <ul className="archive-list">
          {items.map((project) => (
            <li key={project.id} className="archive-row">
              <span className="project-dot" style={{ background: project.color }} />
              <div className="archive-row__text">
                <strong>{project.name}</strong>
                <span>
                  {project.key} · {project._count.tasks} task{project._count.tasks === 1 ? "" : "s"} ·
                  created {new Date(project.createdAt).toLocaleDateString()}
                </span>
              </div>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => void restore(project)}
                disabled={busyId === project.id}
              >
                {busyId === project.id ? "Restoring…" : "Restore"}
              </button>
              <button
                type="button"
                className="btn btn--sm btn--danger"
                onClick={() => void purge(project)}
                disabled={busyId === project.id}
                aria-label={`Delete ${project.name} permanently`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

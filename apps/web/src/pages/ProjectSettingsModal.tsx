import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, api } from "../api";
import { useAuth } from "../auth";
import { Avatar, ErrorNote, Modal } from "../ui";
import type { ProjectDetail, ProjectVisibility, WorkspaceDetail } from "../types";

/**
 * One place for the things that change how a project is shared: whether it is
 * private, who is on the guest list, and whether it should become a template.
 */
export function ProjectSettingsModal({
  open,
  project,
  workspace,
  onClose,
  onChanged,
}: {
  open: boolean;
  project: ProjectDetail | null;
  workspace: WorkspaceDetail;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const { user } = useAuth();
  const canManage = workspace.role === "OWNER" || workspace.role === "ADMIN";

  const [visibility, setVisibility] = useState<ProjectVisibility>("WORKSPACE");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [templateNote, setTemplateNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Only re-seed when the modal opens or the project changes. Live refreshes of
  // the same project must not overwrite what the user is currently picking.
  useEffect(() => {
    if (!open || !project) return;
    setVisibility(project.visibility);
    setMemberIds(project.members.map((member) => member.id));
    setTemplateName(`${project.name} template`);
    setTemplateNote("");
    setError(null);
    setNotice(null);
  }, [open, project?.id]);

  if (!project) return null;

  function toggleMember(userId: string) {
    setMemberIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!project) return;

    setError(null);
    setNotice(null);

    if (visibility === "PRIVATE" && memberIds.length === 0) {
      setError("Pick at least one person who can open this private project");
      return;
    }

    setBusy(true);
    try {
      await api.projects.update(project.id, { visibility });
      if (visibility === "PRIVATE") {
        await api.projects.setMembers(project.id, memberIds);
      }
      await onChanged();
      setNotice(
        visibility === "PRIVATE"
          ? `Only the ${memberIds.length} selected ${memberIds.length === 1 ? "person" : "people"} can open this project.`
          : "Everyone in the workspace can open this project.",
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save these settings");
    } finally {
      setBusy(false);
    }
  }

  async function onSaveTemplate() {
    if (!project) return;
    setError(null);
    setNotice(null);

    if (templateName.trim().length < 2) {
      setError("Give the template a name");
      return;
    }

    setBusy(true);
    try {
      const template = await api.projects.saveTemplate(project.id, {
        name: templateName.trim(),
        description: templateNote.trim() || undefined,
      });
      setNotice(`Saved “${template.name}”. Pick it when you create the next project.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the template");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Settings · ${project.name}`} width={560}>
      <form className="stack" onSubmit={onSave}>
        <fieldset className="settings__group">
          <legend>Who can open it</legend>
          <label className="settings__option">
            <input
              type="radio"
              name="visibility"
              value="WORKSPACE"
              checked={visibility === "WORKSPACE"}
              disabled={!canManage}
              onChange={() => setVisibility("WORKSPACE")}
            />
            <span>
              <strong>Everyone in {workspace.name}</strong>
              <small>Visible to any workspace member, like a normal project.</small>
            </span>
          </label>
          <label className="settings__option">
            <input
              type="radio"
              name="visibility"
              value="PRIVATE"
              checked={visibility === "PRIVATE"}
              disabled={!canManage}
              onChange={() => {
                setVisibility("PRIVATE");
                // Keep the person making the switch on the guest list, otherwise
                // they would have to remember to tick their own name.
                if (memberIds.length === 0 && user) setMemberIds([user.id]);
              }}
            />
            <span>
              <strong>Only selected people</strong>
              <small>Admins still see it; other members need an invitation.</small>
            </span>
          </label>
        </fieldset>

        {visibility === "PRIVATE" ? (
          <fieldset className="settings__group">
            <legend>Guest list · {memberIds.length} selected</legend>
            <ul className="settings__members">
              {workspace.members.map((member) => (
                <li key={member.user.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={memberIds.includes(member.user.id)}
                      disabled={!canManage}
                      onChange={() => toggleMember(member.user.id)}
                    />
                    <Avatar user={member.user} size={24} />
                    <span>{member.user.name}</span>
                    {member.user.id === user?.id ? <span className="hint">you</span> : null}
                    {member.role !== "MEMBER" ? (
                      <span className="hint">{member.role.toLowerCase()}</span>
                    ) : null}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ) : null}

        {!canManage ? (
          <p className="hint">
            Only owners and admins can change who sees a project. Ask an admin if this looks wrong.
          </p>
        ) : null}

        <ErrorNote message={error} />
        {notice ? <p className="notice" role="status">{notice}</p> : null}

        <div className="row row--end">
          <button type="submit" className="btn btn--primary" disabled={busy || !canManage}>
            {busy ? "Saving…" : "Save sharing"}
          </button>
        </div>
      </form>

      <section className="settings__template">
        <h3>Reuse this project</h3>
        <p className="hint">
          Saves the columns, custom fields and up to 30 tasks as a blueprint for new projects.
        </p>
        <label className="field">
          <span>Template name</span>
          <input value={templateName} onChange={(event) => setTemplateName(event.target.value)} />
        </label>
        <label className="field">
          <span>Note (optional)</span>
          <input
            value={templateNote}
            onChange={(event) => setTemplateNote(event.target.value)}
            placeholder="When should the team use this?"
          />
        </label>
        <div className="row row--end">
          <button type="button" className="btn" onClick={() => void onSaveTemplate()} disabled={busy}>
            Save as template
          </button>
        </div>
      </section>
    </Modal>
  );
}

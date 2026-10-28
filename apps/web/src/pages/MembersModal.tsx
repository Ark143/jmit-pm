import { useState } from "react";
import type { FormEvent } from "react";
import { ApiError, api } from "../api";
import { useAuth } from "../auth";
import { Avatar, ErrorNote, Modal } from "../ui";
import type { Role, WorkspaceDetail } from "../types";

const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
};

export function MembersModal({
  open,
  workspace,
  onClose,
  onChanged,
}: {
  open: boolean;
  workspace: WorkspaceDetail | null;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("MEMBER");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!workspace) return null;

  const canManage = workspace.role === "OWNER" || workspace.role === "ADMIN";

  async function onInvite(event: FormEvent) {
    event.preventDefault();
    if (!workspace) return;

    setBusy(true);
    setError(null);
    try {
      await api.workspaces.addMember(workspace.id, { email, role });
      setEmail("");
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add that person");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(userId: string) {
    if (!workspace) return;
    setError(null);
    try {
      await api.workspaces.removeMember(workspace.id, userId);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove that person");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Members · ${workspace.name}`} width={520}>
      <ul className="member-list">
        {workspace.members.map((member) => (
          <li key={member.user.id}>
            <Avatar user={member.user} size={32} />
            <div className="member-list__text">
              <strong>{member.user.name}</strong>
              <span>{member.user.email}</span>
            </div>
            <span className={`badge badge--role badge--${member.role.toLowerCase()}`}>
              {ROLE_LABEL[member.role]}
            </span>
            {canManage && member.user.id !== user?.id && member.role !== "OWNER" ? (
              <button
                type="button"
                className="icon-btn icon-btn--sm"
                onClick={() => void onRemove(member.user.id)}
                aria-label={`Remove ${member.user.name}`}
                title="Remove from workspace"
              >
                ✕
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {canManage ? (
        <form className="stack members__invite" onSubmit={onInvite}>
          <label className="field">
            <span>Add by email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              placeholder="teammate@company.com"
            />
          </label>
          <div className="row row--end">
            <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
              <option value="MEMBER">Member</option>
              <option value="ADMIN">Admin</option>
            </select>
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? "Adding…" : "Add member"}
            </button>
          </div>
          <ErrorNote message={error} />
          <p className="hint">The person needs an account first — invites are by existing email.</p>
        </form>
      ) : (
        <p className="hint">Only owners and admins can manage members.</p>
      )}
    </Modal>
  );
}

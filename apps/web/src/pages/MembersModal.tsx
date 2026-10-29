import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, api, saveTextFile } from "../api";
import { useAuth } from "../auth";
import { Avatar, ErrorNote, Modal } from "../ui";
import type { Role, WorkspaceDetail, WorkspaceInvite } from "../types";

const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
};

function joinLink(token: string) {
  return `${window.location.origin}${window.location.pathname}#/join/${token}`;
}

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
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [created, setCreated] = useState<WorkspaceInvite | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupNote, setBackupNote] = useState<string | null>(null);

  const workspaceId = workspace?.id ?? null;
  const canManage = workspace?.role === "OWNER" || workspace?.role === "ADMIN";

  useEffect(() => {
    if (!open || !workspaceId || !canManage) return;
    setError(null);
    api.workspaces
      .invites(workspaceId)
      .then(setInvites)
      .catch(() => setInvites([]));
  }, [open, workspaceId, canManage]);

  if (!workspace) return null;

  async function onInvite(event: FormEvent) {
    event.preventDefault();
    if (!workspace) return;

    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const invite = await api.workspaces.createInvite(workspace.id, { email, role });
      setCreated(invite);
      setInvites((current) => [invite, ...current]);
      setEmail("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create that invite");
    } finally {
      setBusy(false);
    }
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(joinLink(token));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy failed — select the link and copy it manually.");
    }
  }

  async function revoke(inviteId: string) {
    setError(null);
    try {
      await api.invites.revoke(inviteId);
      setInvites((current) => current.filter((invite) => invite.id !== inviteId));
      if (created?.id === inviteId) setCreated(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not cancel that invite");
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

  async function downloadBackup() {
    if (!workspace) return;
    setBackupBusy(true);
    setBackupNote(null);
    try {
      const { filename, json } = await api.workspaces.backup(workspace.id);
      saveTextFile(filename, json);
      setBackupNote("Backup downloaded.");
    } catch (err) {
      setBackupNote(err instanceof ApiError ? err.message : "Could not build the backup");
    } finally {
      setBackupBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Members · ${workspace.name}`} width={560}>
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
        <>
          <form className="stack members__invite" onSubmit={onInvite}>
            <label className="field">
              <span>Invite by email</span>
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
                {busy ? "Creating…" : "Create invite link"}
              </button>
            </div>
            <p className="hint">
              They use the link to sign up with this address, so nobody has to be registered first.
            </p>
            <ErrorNote message={error} />
          </form>

          {created ? (
            <div className="invite-created">
              <p>
                <strong>Share this link with {created.email}</strong>
              </p>
              <div className="invite-created__row">
                <input readOnly value={joinLink(created.token)} aria-label="Invite link" />
                <button type="button" className="btn btn--sm btn--primary" onClick={() => void copy(created.token)}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="hint">The link expires in 14 days and only works for that email.</p>
            </div>
          ) : null}

          {invites.length > 0 ? (
            <section className="pending-invites">
              <h3>Pending invites</h3>
              <ul>
                {invites.map((invite) => (
                  <li key={invite.id}>
                    <span className="pending-invites__email">{invite.email}</span>
                    <span className="badge badge--plain">{ROLE_LABEL[invite.role]}</span>
                    <span className="hint">
                      expires{" "}
                      {new Date(invite.expiresAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => void copy(invite.token)}
                    >
                      Copy link
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn--sm"
                      aria-label={`Cancel invite for ${invite.email}`}
                      title="Cancel invite"
                      onClick={() => void revoke(invite.id)}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="backup-box">
            <h3>Data &amp; backups</h3>
            <p className="hint">
              Download a JSON snapshot of this workspace — projects, tasks, comments, time logs, and
              settings. Attachment files are listed but not bundled.
            </p>
            <div className="row">
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => void downloadBackup()}
                disabled={backupBusy}
              >
                {backupBusy ? "Preparing…" : "Download backup"}
              </button>
              {backupNote ? (
                <span className="hint" role="status">
                  {backupNote}
                </span>
              ) : null}
            </div>
          </section>
        </>
      ) : (
        <p className="hint">Only owners and admins can manage members.</p>
      )}
    </Modal>
  );
}

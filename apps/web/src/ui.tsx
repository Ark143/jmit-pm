import { useEffect } from "react";
import type { ReactNode } from "react";
import { PRIORITY_META, avatarColor, initials } from "./lib";
import type { Priority, User } from "./types";

export function Avatar({
  user,
  size = 26,
  title,
}: {
  user: Pick<User, "name" | "color">;
  size?: number;
  title?: string;
}) {
  return (
    <span
      className="avatar"
      title={title ?? user.name}
      style={{
        width: size,
        height: size,
        background: avatarColor(user),
        fontSize: Math.max(10, Math.round(size * 0.4)),
      }}
    >
      {initials(user.name)}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const meta = PRIORITY_META[priority];
  return (
    <span className="badge" style={{ color: meta.color, borderColor: `${meta.color}55` }}>
      <span className="dot" style={{ background: meta.color }} />
      {meta.label}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="loading">
      <span className="spinner" aria-hidden="true" />
      {label ? <span>{label}</span> : null}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 460,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="scrim" role="presentation" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ maxWidth: width }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal__head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="error-note" role="alert">
      {message}
    </p>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

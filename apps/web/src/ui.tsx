import { useEffect, useRef } from "react";
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

// Modals can stack (project settings opening a confirm, for example), so the
// page scroll lock is reference counted instead of blindly toggled.
let openModals = 0;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    openModals += 1;
    document.body.classList.add("modal-open");

    const focusable = (): HTMLElement[] => {
      const panel = panelRef.current;
      if (!panel) return [];
      return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null,
      );
    };

    // Land on the first real field when the dialog is a form, otherwise on the
    // panel itself so screen readers announce the title.
    const fields = focusable().filter((element) =>
      element.matches("input, textarea, select"),
    );
    (fields[0] ?? focusable()[0] ?? panelRef.current)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panelRef.current?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      openModals = Math.max(0, openModals - 1);
      if (openModals === 0) document.body.classList.remove("modal-open");
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="scrim" role="presentation" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
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

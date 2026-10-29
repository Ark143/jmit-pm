import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { timeAgo } from "../lib";
import { useLiveRefresh } from "../live";
import type { AppNotification, NotificationFeed } from "../types";

/**
 * Inbox in the top bar. SSE tells us when the workspace moves, the 30 second
 * poll covers the case where the stream is blocked by a proxy.
 */
export function NotificationBell({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  const [feed, setFeed] = useState<NotificationFeed | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      setFeed(await api.notifications.list(workspaceId));
    } catch {
      // A missing badge is not worth an error banner.
    }
  }, [workspaceId]);

  useEffect(() => {
    setFeed(null);
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useLiveRefresh(() => void load());

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markAll() {
    setBusy(true);
    try {
      await api.notifications.markAllRead(workspaceId);
      setFeed((current) =>
        current
          ? { unread: 0, items: current.items.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })) }
          : current,
      );
    } finally {
      setBusy(false);
    }
  }

  async function openItem(item: AppNotification) {
    setOpen(false);
    if (!item.readAt) {
      setFeed((current) =>
        current
          ? {
              unread: Math.max(0, current.unread - 1),
              items: current.items.map((entry) =>
                entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry,
              ),
            }
          : current,
      );
      void api.notifications.markRead(item.id).catch(() => undefined);
    }
    if (item.task) navigate(`/p/${item.task.project.id}?task=${item.task.id}`);
  }

  const unread = feed?.unread ?? 0;

  return (
    <div className="bell" ref={boxRef}>
      <button
        type="button"
        className="icon-btn bell__button"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">◔</span>
        {unread > 0 ? <span className="bell__count">{unread > 9 ? "9+" : unread}</span> : null}
      </button>

      {open ? (
        <div className="bell__panel" role="dialog" aria-label="Notifications">
          <header className="bell__head">
            <strong>Notifications</strong>
            {unread > 0 ? (
              <button type="button" className="btn btn--sm" onClick={() => void markAll()} disabled={busy}>
                Mark all read
              </button>
            ) : null}
          </header>

          {!feed ? (
            <p className="hint bell__empty">Loading…</p>
          ) : feed.items.length === 0 ? (
            <p className="hint bell__empty">
              Nothing yet. Assignments, comments and reminders land here.
            </p>
          ) : (
            <ul className="bell__list">
              {feed.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`bell__item ${item.readAt ? "" : "is-unread"}`}
                    onClick={() => void openItem(item)}
                  >
                    <span className="bell__dot" aria-hidden="true" />
                    <span className="bell__text">
                      <strong>{item.title}</strong>
                      {item.body ? <span>{item.body}</span> : null}
                      <time dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

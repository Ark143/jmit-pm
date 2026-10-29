import { useEffect, useRef } from "react";

type Listener = (event: string) => void;

const listeners = new Set<Listener>();

/** Fired by the SSE bridge in WorkspaceShell, consumed by any mounted page. */
export function publishLive(event: string) {
  for (const listener of listeners) listener(event);
}

export function subscribeLive(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Re-runs a page loader shortly after another member touches the workspace.
 * The small delay collapses bursts (a board move emits several rows) into one
 * refetch instead of a request storm.
 */
export function useLiveRefresh(refresh: () => void) {
  const latest = useRef(refresh);
  latest.current = refresh;

  useEffect(() => {
    let timer: number | undefined;

    const unsubscribe = subscribeLive((event) => {
      if (event === "ping") return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => latest.current(), 700);
    });

    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);
}

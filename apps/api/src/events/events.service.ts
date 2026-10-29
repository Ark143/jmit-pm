import { Injectable } from "@nestjs/common";
import { Observable, Subject, interval, map, merge } from "rxjs";

export interface WorkspaceEvent {
  type: string;
  taskId?: string;
  at: string;
}

type StreamMessage = { data: WorkspaceEvent | { type: "ping" } };

/**
 * In-memory fan-out for "something changed in this workspace" signals.
 * A single Render instance serves every request, so a process-local hub is
 * enough; swapping in Redis pub/sub later only changes this file.
 */
@Injectable()
export class EventsService {
  private readonly hubs = new Map<string, Subject<WorkspaceEvent>>();

  private hub(workspaceId: string) {
    let hub = this.hubs.get(workspaceId);
    if (!hub) {
      hub = new Subject<WorkspaceEvent>();
      this.hubs.set(workspaceId, hub);
    }
    return hub;
  }

  emit(workspaceId: string, type: string, taskId?: string) {
    const hub = this.hubs.get(workspaceId);
    if (!hub) return;
    hub.next({ type, taskId, at: new Date().toISOString() });
  }

  subscribe(workspaceId: string): Observable<StreamMessage> {
    const hub = this.hub(workspaceId);
    const events = hub.pipe(map((event) => ({ data: event })));
    // Keeps proxies from closing an idle stream and lets clients notice dead links.
    const heartbeat = interval(25_000).pipe(map(() => ({ data: { type: "ping" } as const })));

    return merge(events, heartbeat);
  }
}

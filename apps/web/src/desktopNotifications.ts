import type {
  EnvironmentId,
  ProjectId,
  ThreadId,
  OrchestrationThreadShell,
} from "@t3tools/contracts";
import { projectThreadAwareness, type AgentAwarenessPhase } from "@t3tools/shared/agentAwareness";

export interface DesktopNotificationThreadSnapshot {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly projectTitle: string;
  readonly threadTitle: string;
  readonly phase: AgentAwarenessPhase | null;
}

export interface DesktopThreadNotificationCandidate {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectTitle: string;
  readonly threadTitle: string;
  readonly phase: "completed" | "failed";
}

interface ObservedThreadState {
  readonly phase: AgentAwarenessPhase | null;
  readonly armed: boolean;
}

const ACTIVE_PHASES = new Set<AgentAwarenessPhase>([
  "starting",
  "running",
  "waiting_for_approval",
  "waiting_for_input",
]);

function notificationThreadKey(
  snapshot: Pick<DesktopNotificationThreadSnapshot, "environmentId" | "threadId">,
): string {
  return `${snapshot.environmentId}\u0000${snapshot.threadId}`;
}

export function projectDesktopNotificationThreadSnapshot(input: {
  readonly environmentId: EnvironmentId;
  readonly projectTitle: string;
  readonly thread: OrchestrationThreadShell;
}): DesktopNotificationThreadSnapshot {
  const awareness = projectThreadAwareness({
    environmentId: input.environmentId,
    project: { title: input.projectTitle },
    thread: input.thread,
  });
  return {
    environmentId: input.environmentId,
    threadId: input.thread.id,
    projectId: input.thread.projectId,
    projectTitle: input.projectTitle,
    threadTitle: input.thread.title,
    phase: awareness?.phase ?? null,
  };
}

export class DesktopNotificationTransitionController {
  readonly #observed = new Map<string, ObservedThreadState>();

  update(
    snapshots: readonly DesktopNotificationThreadSnapshot[],
  ): DesktopThreadNotificationCandidate[] {
    const candidates: DesktopThreadNotificationCandidate[] = [];
    const presentKeys = new Set<string>();

    for (const snapshot of snapshots) {
      const key = notificationThreadKey(snapshot);
      presentKeys.add(key);
      const previous = this.#observed.get(key);
      const isActive = snapshot.phase !== null && ACTIVE_PHASES.has(snapshot.phase);
      const isTerminal = snapshot.phase === "completed" || snapshot.phase === "failed";

      if (isTerminal && previous?.armed === true) {
        candidates.push({
          environmentId: snapshot.environmentId,
          threadId: snapshot.threadId,
          projectTitle: snapshot.projectTitle,
          threadTitle: snapshot.threadTitle,
          phase: snapshot.phase,
        });
      }

      this.#observed.set(key, {
        phase: snapshot.phase,
        // A transient null projection between running and terminal must not
        // disarm the completion notification.
        armed: isActive || (snapshot.phase === null && previous?.armed === true),
      });
    }

    for (const key of this.#observed.keys()) {
      if (!presentKeys.has(key)) {
        this.#observed.delete(key);
      }
    }

    return candidates;
  }
}

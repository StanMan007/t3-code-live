import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import {
  ProviderSessionReaper,
  type ProviderSessionReaperShape,
} from "../Services/ProviderSessionReaper.ts";
import { ProviderService } from "../Services/ProviderService.ts";

const DEFAULT_INACTIVITY_THRESHOLD_MS = 30 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_BACKGROUND_TASK_STALL_THRESHOLD_MS = 60 * 60 * 1000;

export interface ProviderSessionReaperLiveOptions {
  readonly inactivityThresholdMs?: number;
  readonly sweepIntervalMs?: number;
  readonly backgroundTaskStallThresholdMs?: number;
}

function readBackgroundTaskLease(runtimePayload: unknown): {
  readonly taskIds: ReadonlyArray<string>;
  readonly lastProgressAt?: string;
} {
  if (
    runtimePayload === null ||
    typeof runtimePayload !== "object" ||
    Array.isArray(runtimePayload)
  ) {
    return { taskIds: [] };
  }
  const payload = runtimePayload as Record<string, unknown>;
  const taskIds = Array.isArray(payload.backgroundTaskIds)
    ? payload.backgroundTaskIds.filter(
        (taskId): taskId is string => typeof taskId === "string" && taskId.length > 0,
      )
    : [];
  return {
    taskIds,
    ...(typeof payload.backgroundTaskLastProgressAt === "string"
      ? { lastProgressAt: payload.backgroundTaskLastProgressAt }
      : {}),
  };
}

const makeProviderSessionReaper = (options?: ProviderSessionReaperLiveOptions) =>
  Effect.gen(function* () {
    const providerService = yield* ProviderService;
    const directory = yield* ProviderSessionDirectory;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

    const inactivityThresholdMs = Math.max(
      1,
      options?.inactivityThresholdMs ?? DEFAULT_INACTIVITY_THRESHOLD_MS,
    );
    const sweepIntervalMs = Math.max(1, options?.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS);
    const backgroundTaskStallThresholdMs = Math.max(
      1,
      options?.backgroundTaskStallThresholdMs ?? DEFAULT_BACKGROUND_TASK_STALL_THRESHOLD_MS,
    );

    const sweep = Effect.gen(function* () {
      const bindings = yield* directory.listBindings();
      const now = yield* Clock.currentTimeMillis;
      let reapedCount = 0;

      for (const binding of bindings) {
        if (binding.status === "stopped") {
          continue;
        }

        const lastSeenMs = Date.parse(binding.lastSeenAt);
        if (Number.isNaN(lastSeenMs)) {
          yield* Effect.logWarning("provider.session.reaper.invalid-last-seen", {
            threadId: binding.threadId,
            provider: binding.provider,
            lastSeenAt: binding.lastSeenAt,
          });
          continue;
        }

        const idleDurationMs = now - lastSeenMs;
        const backgroundTaskLease = readBackgroundTaskLease(binding.runtimePayload);
        const lastBackgroundProgressMs = backgroundTaskLease.lastProgressAt
          ? Date.parse(backgroundTaskLease.lastProgressAt)
          : Number.NaN;
        const backgroundTaskProgressAgeMs = Number.isNaN(lastBackgroundProgressMs)
          ? Number.POSITIVE_INFINITY
          : now - lastBackgroundProgressMs;
        const hasActiveBackgroundTasks = backgroundTaskLease.taskIds.length > 0;
        const backgroundWorkStalled =
          hasActiveBackgroundTasks && backgroundTaskProgressAgeMs >= backgroundTaskStallThresholdMs;

        if (hasActiveBackgroundTasks && !backgroundWorkStalled) {
          yield* Effect.logDebug("provider.session.reaper.skipped-active-background-work", {
            threadId: binding.threadId,
            taskIds: backgroundTaskLease.taskIds,
            backgroundTaskProgressAgeMs,
            idleDurationMs,
          });
          continue;
        }
        if (!backgroundWorkStalled && idleDurationMs < inactivityThresholdMs) continue;

        const thread = yield* projectionSnapshotQuery
          .getThreadShellById(binding.threadId)
          .pipe(Effect.map(Option.getOrUndefined));
        if (thread?.session?.activeTurnId != null && !backgroundWorkStalled) {
          yield* Effect.logDebug("provider.session.reaper.skipped-active-turn", {
            threadId: binding.threadId,
            activeTurnId: thread.session.activeTurnId,
            idleDurationMs,
          });
          continue;
        }

        const reaped = yield* providerService.stopSession({ threadId: binding.threadId }).pipe(
          Effect.tap(() =>
            Effect.logInfo("provider.session.reaped", {
              threadId: binding.threadId,
              provider: binding.provider,
              idleDurationMs,
              reason: backgroundWorkStalled ? "background_work_stalled" : "inactivity_threshold",
              ...(backgroundWorkStalled
                ? {
                    taskIds: backgroundTaskLease.taskIds,
                    backgroundTaskProgressAgeMs,
                  }
                : {}),
            }),
          ),
          Effect.as(true),
          Effect.catchCause((cause) =>
            Effect.logWarning("provider.session.reaper.stop-failed", {
              threadId: binding.threadId,
              provider: binding.provider,
              idleDurationMs,
              cause,
            }).pipe(Effect.as(false)),
          ),
        );

        if (reaped) {
          reapedCount += 1;
        }
      }

      if (reapedCount > 0) {
        yield* Effect.logInfo("provider.session.reaper.sweep-complete", {
          reapedCount,
          totalBindings: bindings.length,
        });
      }
    });

    const start: ProviderSessionReaperShape["start"] = () =>
      Effect.gen(function* () {
        yield* Effect.forkScoped(
          sweep.pipe(
            Effect.catch((error: unknown) =>
              Effect.logWarning("provider.session.reaper.sweep-failed", {
                error,
              }),
            ),
            Effect.catchDefect((defect: unknown) =>
              Effect.logWarning("provider.session.reaper.sweep-defect", {
                defect,
              }),
            ),
            Effect.repeat(Schedule.spaced(Duration.millis(sweepIntervalMs))),
          ),
        );

        yield* Effect.logInfo("provider.session.reaper.started", {
          inactivityThresholdMs,
          sweepIntervalMs,
          backgroundTaskStallThresholdMs,
        });
      });

    return {
      start,
    } satisfies ProviderSessionReaperShape;
  });

export const makeProviderSessionReaperLive = (options?: ProviderSessionReaperLiveOptions) =>
  Layer.effect(ProviderSessionReaper, makeProviderSessionReaper(options));

export const ProviderSessionReaperLive = makeProviderSessionReaperLive();

import {
  CommandId,
  MessageId,
  type OrchestrationV2ProviderWakeupOrigin,
  type ProviderInstanceId,
  type ProviderSessionId,
  type ProviderThreadId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";

import { OrchestratorV2, type OrchestratorV2Shape } from "./Orchestrator.ts";
import { ProviderWakeupObserver } from "./ProviderSessionManager.ts";
import { randomUuidV4 } from "./RandomUuid.ts";

/**
 * Turns adapter `turn.wakeup` announcements (a provider starting a turn the
 * orchestrator never requested — e.g. the Claude SDK resuming after a
 * background task notification or a scheduled wakeup timer) into visible
 * provider-initiated runs.
 *
 * The session manager consumes the observer at layer construction while the
 * orchestrator (which dispatching requires) is itself built on top of the
 * session manager, so the observer cannot depend on the orchestrator
 * directly. The relay breaks that cycle: the observer enqueues wakeup
 * requests, and a daemon that IS wired to the orchestrator drains the queue
 * and dispatches `message.dispatch` commands with the `attach_wakeup` mode.
 */
export interface ProviderWakeupRequest {
  readonly threadId: ThreadId;
  readonly providerThreadId: ProviderThreadId;
  readonly providerInstanceId: ProviderInstanceId;
  readonly providerSessionId: ProviderSessionId;
  readonly origin: OrchestrationV2ProviderWakeupOrigin;
}

export class ProviderWakeupRelay extends Context.Service<
  ProviderWakeupRelay,
  {
    readonly offer: (input: ProviderWakeupRequest) => Effect.Effect<void>;
    readonly take: Effect.Effect<ProviderWakeupRequest>;
  }
>()("t3/orchestration-v2/ProviderWakeupService/ProviderWakeupRelay") {}

export const relayLayer: Layer.Layer<ProviderWakeupRelay> = Layer.effect(
  ProviderWakeupRelay,
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<ProviderWakeupRequest>();
    return ProviderWakeupRelay.of({
      offer: (input) => Queue.offer(queue, input).pipe(Effect.asVoid),
      take: Queue.take(queue),
    });
  }),
);

export const wakeupObserverLive = Layer.effect(
  ProviderWakeupObserver,
  Effect.gen(function* () {
    const relay = yield* ProviderWakeupRelay;
    return { onWakeup: relay.offer };
  }),
);

const BLOCKING_RUN_STATUSES: ReadonlySet<string> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

const QUIESCENCE_WAIT_ATTEMPTS = 10_000;

const yieldToRuntime = Effect.yieldNow.pipe(
  Effect.andThen(
    Effect.promise(
      () =>
        new Promise<void>((resolve) => {
          setImmediate(resolve);
        }),
    ),
  ),
);

/**
 * A wakeup is announced the instant the provider starts streaming — typically
 * milliseconds after the previous turn's result, before that run's terminal
 * events have committed to the projection. Wait for the thread to quiesce so
 * the attach dispatch does not lose the race against its own predecessor. A
 * thread that stays busy (e.g. a user turn genuinely raced the wakeup) drops
 * the wakeup — the adapter superseded its buffer anyway.
 */
const waitForThreadQuiescence = (orchestrator: OrchestratorV2Shape, input: ProviderWakeupRequest) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < QUIESCENCE_WAIT_ATTEMPTS; attempt += 1) {
      const projection = yield* orchestrator.getThreadProjection(input.threadId);
      const blockingRun = projection.runs.find((run) => BLOCKING_RUN_STATUSES.has(run.status));
      if (blockingRun === undefined) {
        return true;
      }
      yield* yieldToRuntime;
    }
    return false;
  });

/**
 * Dispatch failures are logged, never propagated: a wakeup that loses the
 * race against a user-requested turn (or hits a non-attachable thread state,
 * e.g. a pending context transfer) is intentionally superseded — the adapter
 * drops its buffered activity when the next turn starts.
 */
const dispatchWakeup = (orchestrator: OrchestratorV2Shape, input: ProviderWakeupRequest) =>
  Effect.gen(function* () {
    const quiesced = yield* waitForThreadQuiescence(orchestrator, input);
    if (!quiesced) {
      yield* Effect.logWarning("orchestration-v2.provider-wakeup.thread-stayed-busy", {
        threadId: input.threadId,
        providerThreadId: input.providerThreadId,
        providerSessionId: input.providerSessionId,
      });
      return;
    }
    const uuid = yield* randomUuidV4;
    const dispatched = yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(`command:provider-wakeup:${uuid}`),
      threadId: input.threadId,
      messageId: MessageId.make(`message:provider-wakeup:${uuid}`),
      text: wakeupMessageText(input.origin),
      attachments: [],
      createdBy: "system",
      creationSource: "provider",
      dispatchMode: {
        type: "attach_wakeup",
        providerThreadId: input.providerThreadId,
        origin: input.origin,
      },
    });
    yield* Effect.logInfo("orchestration-v2.provider-wakeup.dispatched", {
      threadId: input.threadId,
      providerThreadId: input.providerThreadId,
      providerSessionId: input.providerSessionId,
      origin: input.origin,
      sequence: dispatched.sequence,
    });
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("orchestration-v2.provider-wakeup.dispatch-failed", {
        threadId: input.threadId,
        providerThreadId: input.providerThreadId,
        providerSessionId: input.providerSessionId,
        origin: input.origin,
        cause,
      }),
    ),
    Effect.asVoid,
  );

export const runWakeupDispatcher: Effect.Effect<
  never,
  never,
  ProviderWakeupRelay | OrchestratorV2
> = Effect.gen(function* () {
  const relay = yield* ProviderWakeupRelay;
  const orchestrator = yield* OrchestratorV2;
  return yield* relay.take.pipe(
    Effect.flatMap((input) => dispatchWakeup(orchestrator, input)),
    Effect.forever,
  );
});

export const wakeupDispatcherDaemonLayer: Layer.Layer<
  never,
  never,
  ProviderWakeupRelay | OrchestratorV2
> = Layer.effectDiscard(runWakeupDispatcher.pipe(Effect.forkScoped));

function wakeupMessageText(origin: OrchestrationV2ProviderWakeupOrigin): string {
  switch (origin.kind) {
    case "task_notification":
      return origin.detail === undefined
        ? "Resumed by the provider: a background task finished."
        : `Resumed by the provider: a background task finished — ${origin.detail}`;
    case "unknown":
      return "Resumed by the provider.";
  }
}

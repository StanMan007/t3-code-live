import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createAtomCommandScheduler, createEnvironmentRpcCommand } from "./runtime.ts";

export function createRealtimeEnvironmentCommands<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  const concurrency = {
    mode: "serial" as const,
    key: ({ environmentId, input }: { environmentId: string; input: { threadId: string } }) =>
      JSON.stringify([environmentId, input.threadId]),
  };

  return {
    start: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:realtime:start",
      tag: WS_METHODS.realtimeStart,
      scheduler,
      concurrency,
    }),
    stop: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:realtime:stop",
      tag: WS_METHODS.realtimeStop,
      scheduler,
      concurrency,
    }),
    appendSpeech: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:realtime:append-speech",
      tag: WS_METHODS.realtimeAppendSpeech,
      scheduler,
      concurrency,
    }),
  };
}

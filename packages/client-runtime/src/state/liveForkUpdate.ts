import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createAtomCommandScheduler, createEnvironmentRpcCommand } from "./runtime.ts";

type LiveForkCommand = "check" | "merge" | "rebuild";

export function liveForkUpdateCommandKey(
  command: LiveForkCommand,
  target: { readonly environmentId: string; readonly input: { readonly cwd: string } },
): string {
  return JSON.stringify([command, target.environmentId, target.input.cwd]);
}

export function createLiveForkUpdateEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  const concurrency = (command: LiveForkCommand) => ({
    mode: "singleFlight" as const,
    key: (target: { readonly environmentId: string; readonly input: { readonly cwd: string } }) =>
      liveForkUpdateCommandKey(command, target),
  });

  return {
    check: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:live-fork-update:check",
      tag: WS_METHODS.liveForkUpdateCheck,
      scheduler,
      concurrency: concurrency("check"),
    }),
    merge: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:live-fork-update:merge",
      tag: WS_METHODS.liveForkUpdateMerge,
      scheduler,
      concurrency: concurrency("merge"),
    }),
    rebuild: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:live-fork:rebuild",
      tag: WS_METHODS.liveForkRebuild,
      scheduler,
      concurrency: concurrency("rebuild"),
    }),
  };
}

import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createAtomCommandScheduler, createEnvironmentRpcCommand } from "./runtime.ts";

export function createLiveForkUpdateEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  const concurrency = {
    mode: "singleFlight" as const,
    key: ({ environmentId, input }: { environmentId: string; input: { cwd: string } }) =>
      JSON.stringify([environmentId, input.cwd]),
  };

  return {
    check: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:live-fork-update:check",
      tag: WS_METHODS.liveForkUpdateCheck,
      scheduler,
      concurrency,
    }),
    merge: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:live-fork-update:merge",
      tag: WS_METHODS.liveForkUpdateMerge,
      scheduler,
      concurrency,
    }),
    rebuild: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:live-fork:rebuild",
      tag: WS_METHODS.liveForkRebuild,
      scheduler,
      concurrency,
    }),
  };
}

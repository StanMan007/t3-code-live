import { createLiveForkUpdateEnvironmentAtoms } from "@t3tools/client-runtime/state/live-fork-update";

import { connectionAtomRuntime } from "../connection/runtime";

export const liveForkUpdateEnvironment =
  createLiveForkUpdateEnvironmentAtoms(connectionAtomRuntime);

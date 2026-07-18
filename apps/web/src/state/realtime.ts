import { createRealtimeEnvironmentCommands } from "@t3tools/client-runtime/state/realtime";

import { connectionAtomRuntime } from "../connection/runtime";

export const realtimeEnvironment = createRealtimeEnvironmentCommands(connectionAtomRuntime);

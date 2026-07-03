import {
  CLAUDE_PROVIDER_WAKEUP_FOLLOW_UP,
  CLAUDE_PROVIDER_WAKEUP_PROMPT,
  type OrchestratorFixtureInput,
} from "../shared.ts";

/**
 * Recorded from thread 47763f5e (2026-07-01): a turn ends with a background
 * watcher still running; the Claude SDK later resumes the session on its own
 * (task_updated + task_notification → init → new streaming turn). The
 * orchestrator must mint a provider-initiated run for that wakeup turn — run
 * ordinal 2 below is created by the wakeup dispatcher, not by a step.
 */
export function claudeProviderWakeupInput(): OrchestratorFixtureInput {
  return {
    steps: [
      { type: "message", text: CLAUDE_PROVIDER_WAKEUP_PROMPT },
      { type: "await_provider_wakeup_run", runOrdinal: 2 },
      { type: "message", text: CLAUDE_PROVIDER_WAKEUP_FOLLOW_UP },
    ],
  };
}

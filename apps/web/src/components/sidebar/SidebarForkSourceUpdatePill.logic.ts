import type { LiveForkUpdateResult } from "@t3tools/contracts";

export type ForkUpdatePillPhase = "idle" | "checking" | "merging" | "launching_agent";

export interface ForkUpdatePillView {
  readonly tone: "neutral" | "primary" | "warning" | "success";
  readonly title: string;
  readonly description: string;
  readonly action: "check" | "merge" | "agent" | "none";
  readonly busy: boolean;
  readonly dismissible: boolean;
}

export function getForkUpdatePillView(
  result: LiveForkUpdateResult | null,
  phase: ForkUpdatePillPhase,
): ForkUpdatePillView | null {
  if (phase === "checking") {
    return {
      tone: "neutral",
      title: "Checking for updates…",
      description: "Fetching the latest upstream/main commit.",
      action: "none",
      busy: true,
      dismissible: false,
    };
  }
  if (phase === "merging") {
    return {
      tone: "primary",
      title: "Merging update…",
      description: "Fetching and merging upstream/main into the T3 Code Live fork.",
      action: "none",
      busy: true,
      dismissible: false,
    };
  }
  if (phase === "launching_agent") {
    return {
      tone: "warning",
      title: "Starting agent…",
      description: "Starting GPT-5.6-Sol on High reasoning with the merge context.",
      action: "none",
      busy: true,
      dismissible: false,
    };
  }
  if (!result || result.status === "current") {
    return {
      tone: "neutral",
      title: "Check for updates",
      description: "Fetch upstream/main and compare it with the T3 Code Live fork.",
      action: "check",
      busy: false,
      dismissible: false,
    };
  }
  if (result.status === "unavailable") {
    return {
      tone: "warning",
      title: "Update check unavailable",
      description: result.detail ?? "The fork updater could not verify its upstream remote.",
      action: "check",
      busy: false,
      dismissible: false,
    };
  }
  if (result.status === "merged") {
    return {
      tone: "success",
      title: "Source updated",
      description: result.detail ?? "T3 Code Live now contains the latest upstream source.",
      action: "none",
      busy: false,
      dismissible: true,
    };
  }
  if (result.status === "needs_agent") {
    return {
      tone: "warning",
      title: "Spin up an agent",
      description:
        result.detail ?? "The automatic merge needs GPT-5.6-Sol to preserve Live Thread.",
      action: "agent",
      busy: false,
      dismissible: false,
    };
  }
  return {
    tone: "primary",
    title: "Update available",
    description: `${result.upstreamAhead} upstream commit${result.upstreamAhead === 1 ? " is" : "s are"} ready to merge into T3 Code Live.`,
    action: "merge",
    busy: false,
    dismissible: true,
  };
}

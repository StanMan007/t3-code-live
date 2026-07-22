import type { LiveForkUpdateResult } from "@t3tools/contracts";

import {
  LIVE_FORK_UPDATE_BLOCKED_MARKER,
  LIVE_FORK_UPDATE_READY_MARKER,
} from "../settings/forkSourceUpdate.logic";

export { LIVE_FORK_UPDATE_BLOCKED_MARKER, LIVE_FORK_UPDATE_READY_MARKER };

export type ForkRepairAgentLifecycle = "working" | "ready" | "review";

export type ForkUpdatePillPhase =
  | "idle"
  | "checking"
  | "merging"
  | "launching_agent"
  | "agent_working"
  | "verifying_agent"
  | "agent_review"
  | "restart_ready"
  | "rebuilding";

export interface ForkUpdatePillView {
  readonly tone: "neutral" | "primary" | "warning" | "success";
  readonly title: string;
  readonly trailingLabel?: string;
  readonly description: string;
  readonly action: "check" | "merge" | "agent" | "open_agent" | "rebuild" | "none";
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
      title: "Checking and syncing…",
      description: "Fetching upstream, merging when needed, and syncing origin/main.",
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
  if (phase === "agent_working") {
    return {
      tone: "warning",
      title: "Agent updating source…",
      description: "GPT-5.6-Sol is merging upstream and verifying the Live Thread integration.",
      action: "none",
      busy: true,
      dismissible: false,
    };
  }
  if (phase === "verifying_agent") {
    return {
      tone: "neutral",
      title: "Verifying agent result…",
      description: "Confirming that upstream/main is fully integrated before offering a restart.",
      action: "none",
      busy: true,
      dismissible: false,
    };
  }
  if (phase === "agent_review") {
    return {
      tone: "warning",
      title: "Review agent result",
      description: "The agent stopped without a verified ready-to-rebuild result.",
      action: "open_agent",
      busy: false,
      dismissible: false,
    };
  }
  if (phase === "restart_ready") {
    return {
      tone: "primary",
      title: "Restart to apply update",
      description: "Rebuild, replace, and relaunch the signed T3 Code Live Nightly app.",
      action: "rebuild",
      busy: false,
      dismissible: false,
    };
  }
  if (phase === "rebuilding") {
    return {
      tone: "primary",
      title: "Rebuilding and restarting…",
      description: "The app will stay open until the signed replacement is ready.",
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
      tone: "primary",
      title: "Restart to apply update",
      description: `${result.detail ?? "T3 Code Live now contains the latest upstream source."} Rebuild and relaunch the signed app.`,
      action: "rebuild",
      busy: false,
      dismissible: false,
    };
  }
  if (result.status === "install_pending") {
    return {
      tone: "primary",
      title: "Restart to apply local source",
      description: result.detail ?? "The installed app was built from an older source commit.",
      action: "rebuild",
      busy: false,
      dismissible: false,
    };
  }
  if (result.status === "sync_pending") {
    return {
      tone: "primary",
      title: "Sync fork to GitHub",
      trailingLabel: `${result.localAheadOrigin} local`,
      description: result.detail ?? "Local main contains commits that are not yet on origin/main.",
      action: "merge",
      busy: false,
      dismissible: false,
    };
  }
  if (result.status === "needs_agent") {
    const behindLabel =
      result.upstreamAhead > 0
        ? `${result.upstreamAhead} commit${result.upstreamAhead === 1 ? "" : "s"} behind upstream.`
        : null;
    return {
      tone: "warning",
      title: "Spin up an agent",
      ...(behindLabel ? { trailingLabel: `${result.upstreamAhead} behind` } : {}),
      description: [
        behindLabel,
        result.detail ?? "The automatic merge needs GPT-5.6-Sol to preserve Live Thread.",
      ]
        .filter((value) => value !== null)
        .join(" "),
      action: "agent",
      busy: false,
      dismissible: false,
    };
  }
  return {
    tone: "primary",
    title: "Update available",
    trailingLabel: `${result.upstreamAhead} behind`,
    description: `${result.upstreamAhead} upstream commit${result.upstreamAhead === 1 ? " is" : "s are"} ready to merge into T3 Code Live.`,
    action: "merge",
    busy: false,
    dismissible: true,
  };
}

export function resolveForkRepairAgentLifecycle(input: {
  readonly latestTurnState: "running" | "interrupted" | "completed" | "error" | null;
  readonly sessionStatus:
    | "idle"
    | "starting"
    | "running"
    | "ready"
    | "interrupted"
    | "stopped"
    | "error"
    | null;
  readonly assistantMessages: ReadonlyArray<{
    readonly text: string;
    readonly streaming: boolean;
  }>;
}): ForkRepairAgentLifecycle {
  if (
    input.latestTurnState === "running" ||
    input.sessionStatus === "starting" ||
    input.sessionStatus === "running"
  ) {
    return "working";
  }

  const finalAssistantMessage = input.assistantMessages.findLast(
    (message) => !message.streaming && message.text.trim().length > 0,
  );
  if (
    input.latestTurnState === "completed" &&
    finalAssistantMessage?.text.includes(LIVE_FORK_UPDATE_READY_MARKER) === true
  ) {
    return "ready";
  }

  if (
    input.latestTurnState === "completed" ||
    input.latestTurnState === "interrupted" ||
    input.latestTurnState === "error" ||
    input.sessionStatus === "interrupted" ||
    input.sessionStatus === "stopped" ||
    input.sessionStatus === "error" ||
    finalAssistantMessage?.text.includes(LIVE_FORK_UPDATE_BLOCKED_MARKER) === true
  ) {
    return "review";
  }

  return "working";
}

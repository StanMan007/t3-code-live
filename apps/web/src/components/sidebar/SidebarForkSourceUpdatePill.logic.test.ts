import { describe, expect, it } from "vite-plus/test";

import type { LiveForkUpdateResult } from "@t3tools/contracts";
import {
  getForkUpdatePillView,
  LIVE_FORK_UPDATE_BLOCKED_MARKER,
  LIVE_FORK_UPDATE_READY_MARKER,
  resolveForkRepairAgentLifecycle,
} from "./SidebarForkSourceUpdatePill.logic";

function result(
  status: LiveForkUpdateResult["status"],
  upstreamAhead = status === "available" || status === "needs_agent" ? 3 : 0,
): LiveForkUpdateResult {
  return {
    status,
    branch: "main",
    currentSha: "abc123",
    upstreamSha: "def456",
    localAhead: 5,
    upstreamAhead,
    conflictingFiles:
      status === "needs_agent" ? ["apps/web/src/components/chat/ChatComposer.tsx"] : [],
  };
}

describe("getForkUpdatePillView", () => {
  it("shows a blue merge action when upstream commits are available", () => {
    expect(getForkUpdatePillView(result("available"), "idle")).toMatchObject({
      tone: "primary",
      title: "Update available",
      trailingLabel: "3 behind",
      action: "merge",
    });
  });

  it("turns orange and offers an agent after an automatic merge conflict", () => {
    expect(getForkUpdatePillView(result("needs_agent"), "idle")).toMatchObject({
      tone: "warning",
      title: "Spin up an agent",
      trailingLabel: "3 behind",
      description:
        "3 commits behind upstream. The automatic merge needs GPT-5.6-Sol to preserve Live Thread.",
      action: "agent",
    });
  });

  it("uses singular commit copy and omits a zero behind count", () => {
    expect(getForkUpdatePillView(result("needs_agent", 1), "idle")).toMatchObject({
      trailingLabel: "1 behind",
      description:
        "1 commit behind upstream. The automatic merge needs GPT-5.6-Sol to preserve Live Thread.",
    });
    expect(getForkUpdatePillView(result("needs_agent", 0), "idle")).not.toHaveProperty(
      "trailingLabel",
    );
  });

  it("keeps the same badge occupied while merging", () => {
    expect(getForkUpdatePillView(result("available"), "merging")).toMatchObject({
      tone: "primary",
      title: "Merging update…",
      busy: true,
      action: "none",
    });
  });

  it("offers a quiet manual refresh when the fork is current", () => {
    expect(getForkUpdatePillView(result("current"), "idle")).toMatchObject({
      tone: "neutral",
      title: "Check for updates",
      action: "check",
    });
  });

  it("spins in place while checking upstream", () => {
    expect(getForkUpdatePillView(result("current"), "checking")).toMatchObject({
      tone: "neutral",
      title: "Checking for updates…",
      busy: true,
    });
  });

  it("moves from the brief launch state to a visible working state", () => {
    expect(getForkUpdatePillView(result("needs_agent"), "launching_agent")).toMatchObject({
      title: "Starting agent…",
      busy: true,
    });
    expect(getForkUpdatePillView(result("needs_agent"), "agent_working")).toMatchObject({
      title: "Agent updating source…",
      busy: true,
    });
  });

  it("turns a verified agent completion into the restart action", () => {
    expect(getForkUpdatePillView(result("current"), "restart_ready")).toMatchObject({
      tone: "primary",
      title: "Restart to apply update",
      action: "rebuild",
      busy: false,
    });
  });

  it("also offers restart after a clean automatic merge", () => {
    expect(getForkUpdatePillView(result("merged"), "idle")).toMatchObject({
      title: "Restart to apply update",
      action: "rebuild",
    });
  });
});

describe("resolveForkRepairAgentLifecycle", () => {
  it("stays working while the agent session is active", () => {
    expect(
      resolveForkRepairAgentLifecycle({
        latestTurnState: "running",
        sessionStatus: "running",
        assistantMessages: [],
      }),
    ).toBe("working");
  });

  it("requires the explicit ready marker before offering a rebuild", () => {
    expect(
      resolveForkRepairAgentLifecycle({
        latestTurnState: "completed",
        sessionStatus: "ready",
        assistantMessages: [
          {
            text: `All gates passed.\n${LIVE_FORK_UPDATE_READY_MARKER}`,
            streaming: false,
          },
        ],
      }),
    ).toBe("ready");
  });

  it("routes interrupted, blocked, and unmarked completions to review", () => {
    expect(
      resolveForkRepairAgentLifecycle({
        latestTurnState: "interrupted",
        sessionStatus: "interrupted",
        assistantMessages: [],
      }),
    ).toBe("review");
    expect(
      resolveForkRepairAgentLifecycle({
        latestTurnState: "completed",
        sessionStatus: "ready",
        assistantMessages: [{ text: LIVE_FORK_UPDATE_BLOCKED_MARKER, streaming: false }],
      }),
    ).toBe("review");
    expect(
      resolveForkRepairAgentLifecycle({
        latestTurnState: "completed",
        sessionStatus: "ready",
        assistantMessages: [{ text: "Finished without a marker.", streaming: false }],
      }),
    ).toBe("review");
  });
});

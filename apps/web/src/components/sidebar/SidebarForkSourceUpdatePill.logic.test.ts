import { describe, expect, it } from "vite-plus/test";

import type { LiveForkUpdateResult } from "@t3tools/contracts";
import { getForkUpdatePillView } from "./SidebarForkSourceUpdatePill.logic";

function result(status: LiveForkUpdateResult["status"]): LiveForkUpdateResult {
  return {
    status,
    branch: "main",
    currentSha: "abc123",
    upstreamSha: "def456",
    localAhead: 5,
    upstreamAhead: status === "available" ? 3 : 0,
    conflictingFiles:
      status === "needs_agent" ? ["apps/web/src/components/chat/ChatComposer.tsx"] : [],
  };
}

describe("getForkUpdatePillView", () => {
  it("shows a blue merge action when upstream commits are available", () => {
    expect(getForkUpdatePillView(result("available"), "idle")).toMatchObject({
      tone: "primary",
      title: "Update available",
      action: "merge",
    });
  });

  it("turns orange and offers an agent after an automatic merge conflict", () => {
    expect(getForkUpdatePillView(result("needs_agent"), "idle")).toMatchObject({
      tone: "warning",
      title: "Spin up an agent",
      action: "agent",
    });
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
});

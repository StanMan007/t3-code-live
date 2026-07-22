import { describe, expect, it } from "vite-plus/test";

import { countActiveTasksForRestart } from "./SidebarLiveRebuild.logic";

describe("countActiveTasksForRestart", () => {
  it("counts starting and running tasks", () => {
    expect(
      countActiveTasksForRestart([
        { session: { status: "starting" } },
        { session: { status: "running" } },
        { session: { status: "ready" } },
        { session: null },
      ]),
    ).toBe(2);
  });

  it("returns zero when no task would be interrupted", () => {
    expect(
      countActiveTasksForRestart([
        { session: { status: "idle" } },
        { session: { status: "interrupted" } },
        { session: { status: "stopped" } },
      ]),
    ).toBe(0);
  });
});

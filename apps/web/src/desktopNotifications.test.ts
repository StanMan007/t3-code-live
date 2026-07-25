import { describe, expect, it } from "vite-plus/test";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

import {
  DesktopNotificationTransitionController,
  type DesktopNotificationThreadSnapshot,
} from "./desktopNotifications";

function snapshot(
  phase: DesktopNotificationThreadSnapshot["phase"],
  overrides: Partial<DesktopNotificationThreadSnapshot> = {},
): DesktopNotificationThreadSnapshot {
  return {
    environmentId: "environment-1" as EnvironmentId,
    threadId: "thread-1" as ThreadId,
    projectId: "project-1" as ProjectId,
    projectTitle: "T3 Code",
    threadTitle: "Add native notifications",
    phase,
    ...overrides,
  };
}

describe("DesktopNotificationTransitionController", () => {
  it("does not alert for terminal state found during initial hydration", () => {
    const controller = new DesktopNotificationTransitionController();

    expect(controller.update([snapshot("completed")])).toEqual([]);
  });

  it("alerts once when an observed run completes", () => {
    const controller = new DesktopNotificationTransitionController();

    expect(controller.update([snapshot("running")])).toEqual([]);
    expect(controller.update([snapshot("completed")])).toEqual([
      {
        environmentId: "environment-1",
        threadId: "thread-1",
        projectTitle: "T3 Code",
        threadTitle: "Add native notifications",
        phase: "completed",
      },
    ]);
    expect(controller.update([snapshot("completed")])).toEqual([]);
  });

  it("stays armed through a transient null projection", () => {
    const controller = new DesktopNotificationTransitionController();

    controller.update([snapshot("running")]);
    controller.update([snapshot(null)]);

    expect(controller.update([snapshot("completed")])).toHaveLength(1);
  });

  it("re-arms for a later run and reports failures", () => {
    const controller = new DesktopNotificationTransitionController();

    controller.update([snapshot("running")]);
    controller.update([snapshot("completed")]);
    controller.update([snapshot("starting")]);

    expect(controller.update([snapshot("failed")])).toEqual([
      expect.objectContaining({ phase: "failed" }),
    ]);
  });

  it("drops removed threads so stale state cannot alert after rehydration", () => {
    const controller = new DesktopNotificationTransitionController();

    controller.update([snapshot("running")]);
    controller.update([]);

    expect(controller.update([snapshot("completed")])).toEqual([]);
  });
});

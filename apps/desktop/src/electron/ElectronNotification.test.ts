import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { beforeEach, vi } from "vite-plus/test";

const { isSupportedMock, notificationInstances, notificationShowMock, openExternalMock } =
  vi.hoisted(() => ({
    isSupportedMock: vi.fn(() => true),
    notificationInstances: [] as Array<{
      options: Record<string, unknown>;
      emit: (event: string, ...args: unknown[]) => void;
    }>,
    notificationShowMock: vi.fn(),
    openExternalMock: vi.fn(),
  }));

vi.mock("electron", () => ({
  Notification: class {
    static isSupported() {
      return isSupportedMock();
    }

    readonly options: Record<string, unknown>;
    readonly listeners = new Map<string, (...args: unknown[]) => void>();

    constructor(options: Record<string, unknown>) {
      this.options = options;
      notificationInstances.push(this);
    }

    once(event: string, listener: (...args: unknown[]) => void) {
      this.listeners.set(event, listener);
      return this;
    }

    emit(event: string, ...args: unknown[]) {
      const listener = this.listeners.get(event);
      this.listeners.delete(event);
      listener?.(...args);
    }

    show() {
      notificationShowMock();
    }
  },
  shell: {
    openExternal: openExternalMock,
  },
}));

import * as ElectronNotification from "./ElectronNotification.ts";

const notificationLayer = ElectronNotification.layer.pipe(
  Layer.provide(Layer.succeed(HostProcessPlatform, "darwin")),
);

describe("ElectronNotification", () => {
  beforeEach(() => {
    isSupportedMock.mockReset();
    isSupportedMock.mockReturnValue(true);
    notificationInstances.splice(0);
    notificationShowMock.mockReset();
    openExternalMock.mockReset();
  });

  it.effect("shows a native notification and preserves its click callback", () =>
    Effect.gen(function* () {
      let clicked = false;
      const service = yield* ElectronNotification.ElectronNotification;
      const shown = yield* service.show({
        title: "Thread finished",
        subtitle: "T3 Code",
        body: "Click to open this thread.",
        onClick: () => {
          clicked = true;
        },
      });

      assert.isTrue(shown);
      assert.equal(notificationShowMock.mock.calls.length, 1);
      assert.deepEqual(notificationInstances[0]?.options, {
        title: "Thread finished",
        subtitle: "T3 Code",
        body: "Click to open this thread.",
      });
      notificationInstances[0]?.emit("click");
      assert.isTrue(clicked);
    }).pipe(Effect.provide(notificationLayer)),
  );

  it.effect("reports unsupported systems without constructing a notification", () =>
    Effect.gen(function* () {
      isSupportedMock.mockReturnValue(false);
      const service = yield* ElectronNotification.ElectronNotification;
      const shown = yield* service.show({
        title: "Thread finished",
        body: "Done.",
        onClick: () => undefined,
      });

      assert.isFalse(shown);
      assert.lengthOf(notificationInstances, 0);
    }).pipe(Effect.provide(notificationLayer)),
  );

  it.effect("opens the macOS notification settings pane", () =>
    Effect.gen(function* () {
      openExternalMock.mockResolvedValue(undefined);
      const service = yield* ElectronNotification.ElectronNotification;

      assert.isTrue(yield* service.openSettings);
      assert.deepEqual(openExternalMock.mock.calls, [
        ["x-apple.systempreferences:com.apple.Notifications-Settings.extension"],
      ]);
    }).pipe(Effect.provide(notificationLayer)),
  );
});

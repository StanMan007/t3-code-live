import type { DesktopThreadNavigation } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type * as Electron from "electron";

import * as ElectronNotification from "../../electron/ElectronNotification.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopWindow from "../../window/DesktopWindow.ts";
import { openDesktopNotificationSettings, showDesktopNotification } from "./notifications.ts";

function electronNotificationLayer(input: {
  readonly show: ElectronNotification.ElectronNotification["Service"]["show"];
  readonly openSettings?: Effect.Effect<boolean>;
}) {
  return Layer.succeed(ElectronNotification.ElectronNotification, {
    show: input.show,
    openSettings: input.openSettings ?? Effect.succeed(false),
  });
}

function electronWindowLayer(focused: boolean) {
  const window = {
    isFocused: () => focused,
  } as Electron.BrowserWindow;
  return Layer.mock(ElectronWindow.ElectronWindow)({
    main: Effect.succeed(Option.some(window)),
  });
}

function desktopWindowLayer(onNavigate?: (target: DesktopThreadNavigation) => void) {
  return Layer.mock(DesktopWindow.DesktopWindow)({
    activate: Effect.void,
    dispatchThreadNavigation: (target) =>
      Effect.sync(() => {
        onNavigate?.(target);
      }),
  });
}

const threadRequest = {
  kind: "thread",
  condition: "unfocused",
  environmentId: "environment-1",
  threadId: "thread-1",
  projectTitle: "T3 Code",
  threadTitle: "Native notifications",
  phase: "completed",
} as const;

describe("desktop notification IPC", () => {
  it.effect("suppresses completion alerts while the main window is focused", () =>
    Effect.gen(function* () {
      const result = yield* showDesktopNotification.handler(threadRequest);
      assert.equal(result, "suppressed");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          electronNotificationLayer({
            show: () => Effect.die("notification should be suppressed"),
          }),
          electronWindowLayer(true),
          desktopWindowLayer(),
        ),
      ),
    ),
  );

  it.effect("shows an unfocused alert and routes its click to the exact thread", () =>
    Effect.gen(function* () {
      let activate: (() => void) | undefined;
      let navigated: DesktopThreadNavigation | undefined;
      const result = yield* showDesktopNotification.handler(threadRequest).pipe(
        Effect.provide(
          Layer.mergeAll(
            electronNotificationLayer({
              show: (input) =>
                Effect.sync(() => {
                  assert.equal(input.title, "Native notifications");
                  assert.equal(input.subtitle, "T3 Code");
                  activate = input.onClick;
                  return true;
                }),
            }),
            electronWindowLayer(false),
            desktopWindowLayer((target) => {
              navigated = target;
            }),
          ),
        ),
      );

      assert.equal(result, "shown");
      activate?.();
      yield* Effect.yieldNow;
      assert.deepEqual(navigated, {
        environmentId: "environment-1",
        threadId: "thread-1",
      });
    }),
  );

  it.effect("opens the operating system notification settings", () =>
    Effect.gen(function* () {
      const result = yield* openDesktopNotificationSettings.handler(undefined);
      assert.isTrue(result);
    }).pipe(
      Effect.provide(
        electronNotificationLayer({
          show: () => Effect.succeed(true),
          openSettings: Effect.succeed(true),
        }),
      ),
    ),
  );
});

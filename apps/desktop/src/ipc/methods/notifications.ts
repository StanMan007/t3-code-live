import {
  DesktopNotificationPresentationResult,
  DesktopNotificationRequest,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ElectronNotification from "../../electron/ElectronNotification.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopWindow from "../../window/DesktopWindow.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const showDesktopNotification = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SHOW_NOTIFICATION_CHANNEL,
  payload: DesktopNotificationRequest,
  result: DesktopNotificationPresentationResult,
  handler: Effect.fn("desktop.ipc.notifications.show")(function* (request) {
    const electronNotification = yield* ElectronNotification.ElectronNotification;
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    const context = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(context);

    if (request.kind === "thread" && request.condition === "unfocused") {
      const mainWindow = yield* electronWindow.main;
      if (Option.isSome(mainWindow) && mainWindow.value.isFocused()) {
        return "suppressed" as const;
      }
    }

    const activation =
      request.kind === "thread"
        ? desktopWindow.dispatchThreadNavigation({
            environmentId: request.environmentId,
            threadId: request.threadId,
          })
        : desktopWindow.activate;
    const shown = yield* electronNotification.show({
      title: request.kind === "thread" ? request.threadTitle : "T3 Code notifications are on",
      ...(request.kind === "thread" && request.projectTitle.trim().length > 0
        ? { subtitle: request.projectTitle.trim() }
        : {}),
      body:
        request.kind === "test"
          ? "You’ll be notified when a thread finishes."
          : request.phase === "failed"
            ? "Agent failed. Click to open this thread."
            : "Agent finished. Click to open this thread.",
      onClick: () => {
        void runPromise(activation);
      },
      onFailed: (message) => {
        void runPromise(
          Effect.logWarning("Desktop notification failed.").pipe(Effect.annotateLogs({ message })),
        );
      },
    });
    return shown ? ("shown" as const) : ("unsupported" as const);
  }),
});

export const openDesktopNotificationSettings = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.OPEN_NOTIFICATION_SETTINGS_CHANNEL,
  payload: Schema.Void,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.notifications.openSettings")(function* () {
    const electronNotification = yield* ElectronNotification.ElectronNotification;
    return yield* electronNotification.openSettings;
  }),
});

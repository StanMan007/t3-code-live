import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Electron from "electron";

export interface ElectronNotificationInput {
  readonly title: string;
  readonly subtitle?: string;
  readonly body: string;
  readonly onClick: () => void;
  readonly onFailed?: (message: string) => void;
}

export class ElectronNotificationShowError extends Schema.TaggedErrorClass<ElectronNotificationShowError>()(
  "ElectronNotificationShowError",
  {
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Failed to show a desktop notification.";
  }
}

export class ElectronNotification extends Context.Service<
  ElectronNotification,
  {
    readonly show: (
      input: ElectronNotificationInput,
    ) => Effect.Effect<boolean, ElectronNotificationShowError>;
    readonly openSettings: Effect.Effect<boolean>;
  }
>()("@t3tools/desktop/electron/ElectronNotification") {}

export const make = Effect.gen(function* () {
  const platform = yield* HostProcessPlatform;
  const activeNotifications = new Set<Electron.Notification>();

  return ElectronNotification.of({
    show: (input) =>
      Effect.try({
        try: () => {
          if (!Electron.Notification.isSupported()) {
            return false;
          }

          const notification = new Electron.Notification({
            title: input.title,
            ...(input.subtitle === undefined ? {} : { subtitle: input.subtitle }),
            body: input.body,
          });
          const release = () => {
            activeNotifications.delete(notification);
          };
          notification.once("click", () => {
            release();
            input.onClick();
          });
          notification.once("close", release);
          notification.once("failed", (_event, message) => {
            release();
            input.onFailed?.(message);
          });
          activeNotifications.add(notification);
          notification.show();
          return true;
        },
        catch: (cause) => new ElectronNotificationShowError({ cause }),
      }),
    openSettings: Effect.promise(() => {
      const url =
        platform === "darwin"
          ? "x-apple.systempreferences:com.apple.Notifications-Settings.extension"
          : platform === "win32"
            ? "ms-settings:notifications"
            : null;
      if (url === null) {
        return Promise.resolve(false);
      }
      return Electron.shell.openExternal(url).then(
        () => true,
        () => false,
      );
    }),
  });
});

export const layer = Layer.effect(ElectronNotification, make);

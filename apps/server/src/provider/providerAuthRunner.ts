import {
  ClaudeSettings,
  CodexSettings,
  ProviderDriverKind,
  ServerProviderLoginError,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
  type ServerProviderLoginResult,
} from "@t3tools/contracts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { ServerSettingsService } from "../serverSettings.ts";
import { materializeCodexShadowHome, resolveCodexHomeLayout } from "./Drivers/CodexHomeLayout.ts";
import { makeClaudeEnvironment } from "./Drivers/ClaudeHome.ts";
import { deriveProviderInstanceConfigMap } from "./Layers/ProviderInstanceRegistryHydration.ts";
import { mergeProviderInstanceEnvironment } from "./ProviderInstanceEnvironment.ts";

const CLAUDE_DRIVER = ProviderDriverKind.make("claudeAgent");
const CODEX_DRIVER = ProviderDriverKind.make("codex");
const EMAIL_PATTERN = /[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/;
const decodeClaudeSettings = Schema.decodeUnknownEffect(ClaudeSettings);
const decodeCodexSettings = Schema.decodeUnknownEffect(CodexSettings);

interface ProviderLoginLaunch {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env: NodeJS.ProcessEnv;
}

export interface ProviderAuthRunnerShape {
  readonly startLogin: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ServerProviderLoginResult, ServerProviderLoginError>;
}

export class ProviderAuthRunner extends Context.Service<
  ProviderAuthRunner,
  ProviderAuthRunnerShape
>()("t3/provider/providerAuthRunner") {}

function emailHint(instance: ProviderInstanceConfig): string | undefined {
  return instance.displayName?.match(EMAIL_PATTERN)?.[0];
}

const resolveLoginLaunch = Effect.fn("ProviderAuthRunner.resolveLoginLaunch")(function* (
  instanceId: ProviderInstanceId,
  instance: ProviderInstanceConfig,
): Effect.fn.Return<
  ProviderLoginLaunch,
  ServerProviderLoginError,
  FileSystem.FileSystem | Path.Path
> {
  const baseEnvironment = mergeProviderInstanceEnvironment(instance.environment);

  if (instance.driver === CLAUDE_DRIVER) {
    const config = yield* decodeClaudeSettings(instance.config ?? {}).pipe(
      Effect.mapError(
        (cause) =>
          new ServerProviderLoginError({
            instanceId,
            reason: "The Claude provider configuration is invalid.",
            cause,
          }),
      ),
    );
    const env = yield* makeClaudeEnvironment(config, baseEnvironment);
    const hint = emailHint(instance);
    return {
      command: config.binaryPath,
      args: ["auth", "login", "--claudeai", ...(hint ? ["--email", hint] : [])],
      env,
    };
  }

  if (instance.driver === CODEX_DRIVER) {
    const config = yield* decodeCodexSettings(instance.config ?? {}).pipe(
      Effect.mapError(
        (cause) =>
          new ServerProviderLoginError({
            instanceId,
            reason: "The Codex provider configuration is invalid.",
            cause,
          }),
      ),
    );
    const layout = yield* resolveCodexHomeLayout(config);
    yield* materializeCodexShadowHome(layout).pipe(
      Effect.mapError(
        (cause) =>
          new ServerProviderLoginError({
            instanceId,
            reason: "The isolated Codex home could not be prepared.",
            cause,
          }),
      ),
    );
    return {
      command: config.binaryPath,
      args: ["login"],
      env: {
        ...baseEnvironment,
        ...(layout.effectiveHomePath ? { CODEX_HOME: layout.effectiveHomePath } : {}),
      },
    };
  }

  return yield* new ServerProviderLoginError({
    instanceId,
    reason: `Native login is not supported for the ${instance.driver} provider.`,
  });
});

export const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverSettings = yield* ServerSettingsService;

  const startLogin: ProviderAuthRunnerShape["startLogin"] = Effect.fn(
    "ProviderAuthRunner.startLogin",
  )(function* (instanceId) {
    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError(
        (cause) =>
          new ServerProviderLoginError({
            instanceId,
            reason: "Provider settings could not be read.",
            cause,
          }),
      ),
    );
    const instance = deriveProviderInstanceConfigMap(settings)[instanceId];
    if (!instance) {
      return yield* new ServerProviderLoginError({
        instanceId,
        reason: "The provider instance does not exist.",
      });
    }

    const launch = yield* resolveLoginLaunch(instanceId, instance).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );
    const resolved = yield* resolveSpawnCommand(launch.command, launch.args, {
      env: launch.env,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ServerProviderLoginError({
            instanceId,
            reason: "The provider login command could not be resolved.",
            cause,
          }),
      ),
    );
    const command = ChildProcess.make(resolved.command, resolved.args, {
      detached: true,
      env: launch.env,
      shell: resolved.shell,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    yield* spawner.spawn(command).pipe(
      Effect.flatMap((handle) => handle.unref),
      Effect.asVoid,
      Effect.scoped,
      Effect.mapError(
        (cause) =>
          new ServerProviderLoginError({
            instanceId,
            reason: "The provider login command could not be started.",
            cause,
          }),
      ),
    );

    return {
      instanceId,
      started: true as const,
    };
  });

  return ProviderAuthRunner.of({ startLogin });
});

export const layer = Layer.effect(ProviderAuthRunner, make);

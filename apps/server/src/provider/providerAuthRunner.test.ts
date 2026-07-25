import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstanceConfig,
} from "@t3tools/contracts";
import { SpawnExecutableResolution } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as ServerSettings from "../serverSettings.ts";
import { ProviderAuthRunner, layer } from "./providerAuthRunner.ts";

function detachedHandle(onUnref: () => void) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
    isRunning: Effect.succeed(true),
    kill: () => Effect.void,
    unref: Effect.sync(() => {
      onUnref();
      return Effect.void;
    }),
    stdin: Sink.drain,
    stdout: Stream.empty,
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

it.effect("starts Claude login with the isolated config directory and account hint", () => {
  const instanceId = ProviderInstanceId.make("claude_work");
  const instance = {
    driver: ProviderDriverKind.make("claudeAgent"),
    displayName: "Claude · work@example.com",
    config: {
      enabled: true,
      binaryPath: "/opt/bin/claude",
      homePath: "/tmp/claude-work",
      modelPrefix: "",
      customModels: [],
      launchArgs: "",
    },
  } satisfies ProviderInstanceConfig;
  let spawned: ChildProcess.StandardCommand | undefined;
  let didUnref = false;
  const spawner = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.sync(() => {
        assert.equal(ChildProcess.isStandardCommand(command), true);
        if (!ChildProcess.isStandardCommand(command)) {
          throw new Error("Expected standard command");
        }
        spawned = command;
        return detachedHandle(() => {
          didUnref = true;
        });
      }),
    ),
  );

  return Effect.gen(function* () {
    const auth = yield* ProviderAuthRunner;
    const result = yield* auth.startLogin(instanceId);

    assert.equal(result.started, true);
    assert.ok(spawned);
    assert.equal(spawned.command, "/opt/bin/claude");
    assert.deepEqual(spawned.args, ["auth", "login", "--claudeai", "--email", "work@example.com"]);
    assert.equal(spawned.options.env?.CLAUDE_CONFIG_DIR, "/tmp/claude-work");
    assert.equal(spawned.options.detached, true);
    assert.equal(didUnref, true);
  }).pipe(
    Effect.provide(
      layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            NodeServices.layer,
            spawner,
            ServerSettings.ServerSettingsService.layerTest({
              providerInstances: { [instanceId]: instance },
            }),
            Layer.succeed(SpawnExecutableResolution, (command) => command),
          ),
        ),
      ),
    ),
  );
});

it.effect("starts Codex login with the configured account home", () => {
  const instanceId = ProviderInstanceId.make("codex_work");
  const instance = {
    driver: ProviderDriverKind.make("codex"),
    displayName: "Codex Work",
    config: {
      enabled: true,
      binaryPath: "/opt/bin/codex",
      homePath: "/tmp/codex-work",
      shadowHomePath: "",
      modelPrefix: "work",
      customModels: [],
      launchArgs: "",
    },
  } satisfies ProviderInstanceConfig;
  let spawned: ChildProcess.StandardCommand | undefined;
  let didUnref = false;
  const spawner = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.sync(() => {
        assert.equal(ChildProcess.isStandardCommand(command), true);
        if (!ChildProcess.isStandardCommand(command)) {
          throw new Error("Expected standard command");
        }
        spawned = command;
        return detachedHandle(() => {
          didUnref = true;
        });
      }),
    ),
  );

  return Effect.gen(function* () {
    const auth = yield* ProviderAuthRunner;
    const result = yield* auth.startLogin(instanceId);

    assert.equal(result.started, true);
    assert.ok(spawned);
    assert.equal(spawned.command, "/opt/bin/codex");
    assert.deepEqual(spawned.args, ["login"]);
    assert.equal(spawned.options.env?.CODEX_HOME, "/tmp/codex-work");
    assert.equal(spawned.options.detached, true);
    assert.equal(didUnref, true);
  }).pipe(
    Effect.provide(
      layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            NodeServices.layer,
            spawner,
            ServerSettings.ServerSettingsService.layerTest({
              providerInstances: { [instanceId]: instance },
            }),
            Layer.succeed(SpawnExecutableResolution, (command) => command),
          ),
        ),
      ),
    ),
  );
});

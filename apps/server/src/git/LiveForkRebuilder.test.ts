import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as LiveForkRebuilder from "./LiveForkRebuilder.ts";

function makeHandle(onUnref: () => void, isRunning = true, exitCode = 0) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(42),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(exitCode)),
    isRunning: Effect.succeed(isRunning),
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

describe("LiveForkRebuilder", () => {
  it.effect("starts a detached signed Live Nightly rebuild", () => {
    let spawned: ChildProcess.StandardCommand | undefined;
    let didUnref = false;
    const gitLayer = Layer.mock(GitVcsDriver.GitVcsDriver)({
      execute: () =>
        Effect.succeed({
          exitCode: ChildProcessSpawner.ExitCode(0),
          stdout: "https://github.com/pingdotgg/t3code.git\n",
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
        }),
    });
    const spawnerLayer = Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make((command) =>
        Effect.sync(() => {
          assert.equal(ChildProcess.isStandardCommand(command), true);
          if (ChildProcess.isStandardCommand(command)) spawned = command;
          return makeHandle(() => {
            didUnref = true;
          });
        }),
      ),
    );

    return Effect.gen(function* () {
      const rebuild = yield* Effect.forkChild(
        LiveForkRebuilder.start("/Users/test/T3 Code/t3code"),
      );
      yield* Effect.yieldNow;
      yield* TestClock.adjust("750 millis");
      const result = yield* Fiber.join(rebuild);
      assert.equal(result.status, "started");
      assert.match(result.logPath, /T3 Code Live\/rebuild\.log$/u);
      assert.ok(spawned);
      assert.equal(spawned.command, "/bin/zsh");
      assert.equal(spawned.options.detached, true);
      assert.deepStrictEqual(spawned.args.slice(-2), [
        "/Users/test/T3 Code/t3code",
        result.logPath,
      ]);
      assert.match(spawned.args[1] ?? "", /dist:desktop:dir:arm64/u);
      assert.match(spawned.args[1] ?? "", /--output-dir/u);
      assert.notMatch(spawned.args[1] ?? "", /dir:arm64 -- --output-dir/u);
      assert.notMatch(spawned.args[1] ?? "", /hdiutil/u);
      assert.match(spawned.args[1] ?? "", /com\.stanman\.t3codelive/u);
      assert.match(spawned.args[1] ?? "", /T3CODE_DESKTOP_ASSET_BRAND='nightly'/u);
      assert.match(spawned.args[1] ?? "", /exit_status=\$\?/u);
      assert.match(spawned.args[1] ?? "", /lock_pid_path/u);
      assert.match(spawned.args[1] ?? "", /Recovered an abandoned/u);
      assert.match(spawned.args[1] ?? "", /cannot rebuild from a dirty working tree/u);
      assert.match(spawned.args[1] ?? "", /origin\/main changed during the rebuild/u);
      assert.match(spawned.args[1] ?? "", /refs\/t3-code-live\/installed/u);
      assert.equal(didUnref, true);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          gitLayer,
          spawnerLayer,
          Layer.succeed(HostProcessPlatform, "darwin"),
          TestClock.layer(),
        ),
      ),
    );
  });

  it.effect("rejects a detached rebuild that exits before startup verification", () => {
    const gitLayer = Layer.mock(GitVcsDriver.GitVcsDriver)({
      execute: () =>
        Effect.succeed({
          exitCode: ChildProcessSpawner.ExitCode(0),
          stdout: "https://github.com/pingdotgg/t3code.git\n",
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
        }),
    });
    const spawnerLayer = Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make(() => Effect.succeed(makeHandle(() => undefined, false))),
    );

    return Effect.gen(function* () {
      const rebuild = yield* Effect.forkChild(
        LiveForkRebuilder.start("/Users/test/t3code").pipe(Effect.flip),
      );
      yield* Effect.yieldNow;
      yield* TestClock.adjust("750 millis");
      const error = yield* Fiber.join(rebuild);
      assert.equal(error._tag, "LiveForkRebuildError");
      if (error._tag === "LiveForkRebuildError") {
        assert.match(error.detail, /exited before startup verification/u);
      }
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          gitLayer,
          spawnerLayer,
          Layer.succeed(HostProcessPlatform, "darwin"),
          TestClock.layer(),
        ),
      ),
    );
  });

  it.effect("treats an already-running rebuild as an idempotent success", () => {
    const gitLayer = Layer.mock(GitVcsDriver.GitVcsDriver)({
      execute: () =>
        Effect.succeed({
          exitCode: ChildProcessSpawner.ExitCode(0),
          stdout: "https://github.com/pingdotgg/t3code.git\n",
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
        }),
    });
    const spawnerLayer = Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make(() => Effect.succeed(makeHandle(() => undefined, false, 75))),
    );

    return Effect.gen(function* () {
      const rebuild = yield* Effect.forkChild(LiveForkRebuilder.start("/Users/test/t3code"));
      yield* Effect.yieldNow;
      yield* TestClock.adjust("750 millis");
      const result = yield* Fiber.join(rebuild);
      assert.equal(result.status, "started");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          gitLayer,
          spawnerLayer,
          Layer.succeed(HostProcessPlatform, "darwin"),
          TestClock.layer(),
        ),
      ),
    );
  });
});

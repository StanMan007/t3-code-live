import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as LiveForkRebuilder from "./LiveForkRebuilder.ts";

function makeHandle(onUnref: () => void) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(42),
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
      const result = yield* LiveForkRebuilder.start("/Users/test/T3 Code/t3code");
      assert.equal(result.status, "started");
      assert.match(result.logPath, /T3 Code Live\/rebuild\.log$/u);
      assert.ok(spawned);
      assert.equal(spawned.command, "/bin/zsh");
      assert.equal(spawned.options.detached, true);
      assert.deepStrictEqual(spawned.args.slice(-2), [
        "/Users/test/T3 Code/t3code",
        result.logPath,
      ]);
      assert.match(spawned.args[1] ?? "", /dist:desktop:dmg:arm64/u);
      assert.match(spawned.args[1] ?? "", /com\.stanman\.t3codelive/u);
      assert.equal(didUnref, true);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(gitLayer, spawnerLayer, Layer.succeed(HostProcessPlatform, "darwin")),
      ),
    );
  });
});

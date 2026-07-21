import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as LiveForkUpdater from "./LiveForkUpdater.ts";

function output(stdout = "", exitCode = 0): GitVcsDriver.ExecuteGitResult {
  return {
    exitCode: ChildProcessSpawner.ExitCode(exitCode),
    stdout,
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}

type GitMode = "clean" | "conflict" | "staged" | "dirty-overlap" | "dirty-safe";

function makeGitLayer(mode: GitMode) {
  let mergeAttempted = false;
  let mergeCalls = 0;
  const dirty = mode === "staged" || mode === "dirty-overlap" || mode === "dirty-safe";
  const merged = () => mergeAttempted && (mode === "clean" || mode === "dirty-safe");
  const execute: GitVcsDriver.GitVcsDriver["Service"]["execute"] = (input) => {
    const args = input.args.join(" ");
    if (args === "symbolic-ref --quiet --short HEAD") return Effect.succeed(output("main\n"));
    if (args === "remote get-url upstream") {
      return Effect.succeed(output("https://github.com/pingdotgg/t3code.git\n"));
    }
    if (args === "rev-parse --short=12 HEAD") {
      return Effect.succeed(output(merged() ? "def456\n" : "abc123\n"));
    }
    if (args === "diff --name-only --diff-filter=U -z") {
      return Effect.succeed(
        output(mergeAttempted && mode === "conflict" ? "apps/web/src/ChatComposer.tsx\0" : ""),
      );
    }
    if (args === "status --porcelain=v1 -z") {
      return Effect.succeed(
        output(mode === "staged" ? "M  staged.ts\0" : dirty ? " M local.ts\0?? notes.md\0" : ""),
      );
    }
    if (args === "diff --name-only --cached -z") {
      return Effect.succeed(output(mode === "staged" ? "staged.ts\0" : ""));
    }
    if (args === "diff --name-only -z") {
      return Effect.succeed(output(dirty && mode !== "staged" ? "local.ts\0" : ""));
    }
    if (args === "ls-files --others --exclude-standard -z") {
      return Effect.succeed(output(dirty && mode !== "staged" ? "notes.md\0" : ""));
    }
    if (args === "diff --name-only -z HEAD...upstream/main") {
      return Effect.succeed(
        output(
          mode === "dirty-overlap" ? "local.ts\0apps/server/src/ws.ts\0" : "apps/server/src/ws.ts\0",
        ),
      );
    }
    if (args === "fetch --prune upstream main") return Effect.succeed(output());
    if (args === "rev-parse --short=12 upstream/main") {
      return Effect.succeed(output("def456\n"));
    }
    if (args === "rev-list --left-right --count HEAD...upstream/main") {
      return Effect.succeed(output(merged() ? "6\t0\n" : "5\t2\n"));
    }
    if (args === "merge --no-edit upstream/main") {
      mergeAttempted = true;
      mergeCalls += 1;
      return Effect.succeed(output("", mode === "conflict" ? 1 : 0));
    }
    return assert.fail(`Unexpected git command: ${args}`);
  };

  return {
    layer: Layer.mock(GitVcsDriver.GitVcsDriver)({ execute }),
    getMergeCalls: () => mergeCalls,
  };
}

describe("LiveForkUpdater", () => {
  it.effect("reports upstream commits without starting a merge", () => {
    const git = makeGitLayer("clean");
    return Effect.gen(function* () {
      const result = yield* LiveForkUpdater.check("/repo");
      assert.equal(result.status, "available");
      assert.equal(result.upstreamAhead, 2);
      assert.equal(git.getMergeCalls(), 0);
    }).pipe(Effect.provide(git.layer));
  });

  it.effect("merges a clean upstream update without agent involvement", () => {
    const git = makeGitLayer("clean");
    return Effect.gen(function* () {
      const result = yield* LiveForkUpdater.merge("/repo");
      assert.equal(result.status, "merged");
      assert.equal(result.upstreamAhead, 0);
      assert.equal(git.getMergeCalls(), 1);
    }).pipe(Effect.provide(git.layer));
  });

  it.effect("returns conflict files for the GPT-5.6-Sol fallback", () => {
    const git = makeGitLayer("conflict");
    return Effect.gen(function* () {
      const result = yield* LiveForkUpdater.merge("/repo");
      assert.equal(result.status, "needs_agent");
      assert.deepStrictEqual(result.conflictingFiles, ["apps/web/src/ChatComposer.tsx"]);
      assert.equal(git.getMergeCalls(), 1);
    }).pipe(Effect.provide(git.layer));
  });

  it.effect("does not merge while changes are staged for commit", () => {
    const git = makeGitLayer("staged");
    return Effect.gen(function* () {
      const result = yield* LiveForkUpdater.merge("/repo");
      assert.equal(result.status, "needs_agent");
      assert.match(result.detail ?? "", /staged local changes/u);
      assert.equal(git.getMergeCalls(), 0);
    }).pipe(Effect.provide(git.layer));
  });

  it.effect("does not merge over local changes to files upstream also touched", () => {
    const git = makeGitLayer("dirty-overlap");
    return Effect.gen(function* () {
      const result = yield* LiveForkUpdater.merge("/repo");
      assert.equal(result.status, "needs_agent");
      assert.match(result.detail ?? "", /local changes/u);
      assert.match(result.detail ?? "", /local\.ts/u);
      assert.equal(git.getMergeCalls(), 0);
    }).pipe(Effect.provide(git.layer));
  });

  it.effect("merges past local changes that do not intersect the upstream diff", () => {
    const git = makeGitLayer("dirty-safe");
    return Effect.gen(function* () {
      const result = yield* LiveForkUpdater.merge("/repo");
      assert.equal(result.status, "merged");
      assert.equal(result.upstreamAhead, 0);
      assert.match(result.detail ?? "", /left untouched/u);
      assert.equal(git.getMergeCalls(), 1);
    }).pipe(Effect.provide(git.layer));
  });
});

import * as Effect from "effect/Effect";

import type { LiveForkUpdateResult } from "@t3tools/contracts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

const EXPECTED_UPSTREAM_URL = "https://github.com/pingdotgg/t3code.git";
const UPSTREAM_REF = "upstream/main";

interface LiveForkInspection {
  readonly result: LiveForkUpdateResult;
  readonly dirty: boolean;
}

function splitNullSeparated(input: string): string[] {
  return input.split("\0").filter((value) => value.length > 0);
}

function parseDivergence(input: string): {
  readonly localAhead: number;
  readonly upstreamAhead: number;
} {
  const [localAheadText = "0", upstreamAheadText = "0"] = input.trim().split(/\s+/u);
  return {
    localAhead: Number.parseInt(localAheadText, 10) || 0,
    upstreamAhead: Number.parseInt(upstreamAheadText, 10) || 0,
  };
}

const inspect = Effect.fn("LiveForkUpdater.inspect")(function* (
  cwd: string,
  options: { readonly fetch: boolean },
) {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const run = (operation: string, args: ReadonlyArray<string>, allowNonZeroExit = false) =>
    git.execute({ operation, cwd, args, allowNonZeroExit });

  const branchResult = yield* run(
    "LiveForkUpdater.currentBranch",
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    true,
  );
  const branch = branchResult.exitCode === 0 ? branchResult.stdout.trim() || null : null;
  const upstreamUrlResult = yield* run(
    "LiveForkUpdater.upstreamUrl",
    ["remote", "get-url", "upstream"],
    true,
  );
  const upstreamUrl = upstreamUrlResult.exitCode === 0 ? upstreamUrlResult.stdout.trim() : null;
  const currentShaResult = yield* run(
    "LiveForkUpdater.currentSha",
    ["rev-parse", "--short=12", "HEAD"],
    true,
  );
  const currentSha =
    currentShaResult.exitCode === 0 ? currentShaResult.stdout.trim() || null : null;
  const conflictResult = yield* run("LiveForkUpdater.conflicts", [
    "diff",
    "--name-only",
    "--diff-filter=U",
    "-z",
  ]);
  const conflictingFiles = splitNullSeparated(conflictResult.stdout);
  const statusResult = yield* run("LiveForkUpdater.workingTree", [
    "status",
    "--porcelain=v1",
    "-z",
  ]);
  const dirty = statusResult.stdout.length > 0;

  if (upstreamUrl !== EXPECTED_UPSTREAM_URL) {
    return {
      dirty,
      result: {
        status: "unavailable",
        branch,
        currentSha,
        upstreamSha: null,
        localAhead: 0,
        upstreamAhead: 0,
        conflictingFiles,
        detail: `The upstream remote must be ${EXPECTED_UPSTREAM_URL}.`,
      },
    } satisfies LiveForkInspection;
  }

  if (options.fetch) {
    yield* run("LiveForkUpdater.fetch", ["fetch", "--prune", "upstream", "main"]);
  }

  const upstreamShaResult = yield* run(
    "LiveForkUpdater.upstreamSha",
    ["rev-parse", "--short=12", UPSTREAM_REF],
    true,
  );
  const upstreamSha =
    upstreamShaResult.exitCode === 0 ? upstreamShaResult.stdout.trim() || null : null;
  if (upstreamSha === null || currentSha === null) {
    return {
      dirty,
      result: {
        status: "unavailable",
        branch,
        currentSha,
        upstreamSha,
        localAhead: 0,
        upstreamAhead: 0,
        conflictingFiles,
        detail: "The fork or upstream commit could not be resolved.",
      },
    } satisfies LiveForkInspection;
  }

  const divergenceResult = yield* run("LiveForkUpdater.divergence", [
    "rev-list",
    "--left-right",
    "--count",
    `HEAD...${UPSTREAM_REF}`,
  ]);
  const divergence = parseDivergence(divergenceResult.stdout);
  const result: LiveForkUpdateResult = {
    status:
      conflictingFiles.length > 0
        ? "needs_agent"
        : divergence.upstreamAhead > 0
          ? "available"
          : "current",
    branch,
    currentSha,
    upstreamSha,
    ...divergence,
    conflictingFiles,
    ...(conflictingFiles.length > 0
      ? { detail: "The upstream merge has conflicts that need agent assistance." }
      : branch !== "main"
        ? { detail: "Switch to main before updating T3 Code Live." }
        : {}),
  };

  return { dirty, result } satisfies LiveForkInspection;
});

export const check = Effect.fn("LiveForkUpdater.check")(function* (cwd: string) {
  return (yield* inspect(cwd, { fetch: true })).result;
});

export const merge = Effect.fn("LiveForkUpdater.merge")(function* (cwd: string) {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const inspection = yield* inspect(cwd, { fetch: true });
  const before = inspection.result;

  if (before.status === "unavailable" || before.status === "needs_agent") {
    return before;
  }
  if (before.branch !== "main") {
    return {
      ...before,
      status: "needs_agent",
      detail: "The automatic updater only merges while the fork is on main.",
    } satisfies LiveForkUpdateResult;
  }
  if (before.upstreamAhead === 0) {
    return { ...before, status: "current" } satisfies LiveForkUpdateResult;
  }
  if (inspection.dirty) {
    return {
      ...before,
      status: "needs_agent",
      detail: "The fork has local changes. An agent should preserve them before merging upstream.",
    } satisfies LiveForkUpdateResult;
  }

  const mergeResult = yield* git.execute({
    operation: "LiveForkUpdater.mergeUpstream",
    cwd,
    args: ["merge", "--no-edit", UPSTREAM_REF],
    allowNonZeroExit: true,
    timeoutMs: 120_000,
  });
  const after = yield* inspect(cwd, { fetch: false });

  if (mergeResult.exitCode !== 0) {
    return {
      ...after.result,
      status: "needs_agent",
      detail:
        after.result.conflictingFiles.length > 0
          ? "The automatic merge stopped on conflicts. Start an agent to preserve Live Thread and finish the merge."
          : "Git could not complete the automatic merge. Start an agent to inspect and finish it safely.",
    } satisfies LiveForkUpdateResult;
  }

  return {
    ...after.result,
    status: "merged",
    detail: `Merged ${before.upstreamAhead} upstream commit${before.upstreamAhead === 1 ? "" : "s"}.`,
  } satisfies LiveForkUpdateResult;
});

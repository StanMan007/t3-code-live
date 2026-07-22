import * as NodeOS from "node:os";
import * as FileSystem from "effect/FileSystem";

import * as Effect from "effect/Effect";

import type { LiveForkUpdateResult } from "@t3tools/contracts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

const EXPECTED_UPSTREAM_URL = "https://github.com/pingdotgg/t3code.git";
const EXPECTED_ORIGIN_URL = "https://github.com/StanMan007/t3-code-live.git";
const UPSTREAM_REF = "upstream/main";
const ORIGIN_REF = "origin/main";
const INSTALLED_REF = "refs/t3-code-live/installed";
const REBUILD_LOCK_DIR = `${NodeOS.tmpdir()}/t3-code-live-rebuild.lock`;

interface LiveForkInspection {
  readonly result: LiveForkUpdateResult;
  readonly dirty: boolean;
}

function splitNullSeparated(input: string): string[] {
  return input.split("\0").filter((value) => value.length > 0);
}

function parsePorcelainPaths(input: string): string[] {
  const entries = splitNullSeparated(input);
  const paths: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    if (path) paths.push(path);
    if ((status.includes("R") || status.includes("C")) && entries[index + 1]) {
      paths.push(entries[index + 1]!);
      index += 1;
    }
  }
  return [...new Set(paths)];
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
  const originUrlResult = yield* run(
    "LiveForkUpdater.originUrl",
    ["remote", "get-url", "origin"],
    true,
  );
  const originUrl = originUrlResult.exitCode === 0 ? originUrlResult.stdout.trim() : null;
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
  const dirtyFiles = parsePorcelainPaths(statusResult.stdout);
  const mergeHeadResult = yield* run(
    "LiveForkUpdater.mergeHead",
    ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"],
    true,
  );
  const mergeActive = mergeHeadResult.exitCode === 0;

  if (upstreamUrl !== EXPECTED_UPSTREAM_URL || originUrl !== EXPECTED_ORIGIN_URL) {
    return {
      dirty,
      result: {
        status: "unavailable",
        branch,
        currentSha,
        upstreamSha: null,
        originSha: null,
        installedSha: null,
        localAhead: 0,
        upstreamAhead: 0,
        localAheadOrigin: 0,
        originAhead: 0,
        mergeActive,
        dirtyFiles,
        conflictingFiles,
        detail:
          upstreamUrl !== EXPECTED_UPSTREAM_URL
            ? `The upstream remote must be ${EXPECTED_UPSTREAM_URL}.`
            : `The origin remote must be ${EXPECTED_ORIGIN_URL}.`,
      },
    } satisfies LiveForkInspection;
  }

  if (options.fetch) {
    yield* run("LiveForkUpdater.fetch", ["fetch", "--prune", "upstream", "main"]);
    yield* run("LiveForkUpdater.fetchOrigin", ["fetch", "--prune", "origin", "main"]);
  }

  const upstreamShaResult = yield* run(
    "LiveForkUpdater.upstreamSha",
    ["rev-parse", "--short=12", UPSTREAM_REF],
    true,
  );
  const upstreamSha =
    upstreamShaResult.exitCode === 0 ? upstreamShaResult.stdout.trim() || null : null;
  const originShaResult = yield* run(
    "LiveForkUpdater.originSha",
    ["rev-parse", "--short=12", ORIGIN_REF],
    true,
  );
  const originSha = originShaResult.exitCode === 0 ? originShaResult.stdout.trim() || null : null;
  const installedShaResult = yield* run(
    "LiveForkUpdater.installedSha",
    ["rev-parse", "--short=12", INSTALLED_REF],
    true,
  );
  const installedSha =
    installedShaResult.exitCode === 0 ? installedShaResult.stdout.trim() || null : null;
  if (upstreamSha === null || originSha === null || currentSha === null) {
    return {
      dirty,
      result: {
        status: "unavailable",
        branch,
        currentSha,
        upstreamSha,
        originSha,
        installedSha,
        localAhead: 0,
        upstreamAhead: 0,
        localAheadOrigin: 0,
        originAhead: 0,
        mergeActive,
        dirtyFiles,
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
  const originDivergenceResult = yield* run("LiveForkUpdater.originDivergence", [
    "rev-list",
    "--left-right",
    "--count",
    `${ORIGIN_REF}...HEAD`,
  ]);
  const originDivergence = parseDivergence(originDivergenceResult.stdout);
  const originAhead = originDivergence.localAhead;
  const localAheadOrigin = originDivergence.upstreamAhead;
  const status: LiveForkUpdateResult["status"] =
    conflictingFiles.length > 0
      ? "merge_conflict"
      : mergeActive
        ? "needs_agent"
        : branch !== "main"
          ? "needs_agent"
          : originAhead > 0
            ? "origin_diverged"
            : dirty
              ? "local_changes"
              : divergence.upstreamAhead > 0
                ? "available"
                : localAheadOrigin > 0
                  ? "sync_pending"
                  : installedSha !== null && installedSha !== currentSha
                    ? "install_pending"
                    : "current";
  const detail =
    conflictingFiles.length > 0
      ? "The upstream merge has conflicts that need agent assistance."
      : mergeActive
        ? "A Git merge is active and needs agent inspection before updating can continue."
        : branch !== "main"
          ? "Switch to main before updating T3 Code Live."
          : originAhead > 0
            ? `origin/main has ${originAhead} commit${originAhead === 1 ? "" : "s"} that local main does not contain. An agent should reconcile the fork before syncing upstream.`
            : dirty
              ? `The fork has uncommitted local changes in ${dirtyFiles.length} path${dirtyFiles.length === 1 ? "" : "s"}. Finish or checkpoint the local feature before syncing upstream.`
              : localAheadOrigin > 0 && divergence.upstreamAhead === 0
                ? `${localAheadOrigin} local commit${localAheadOrigin === 1 ? " is" : "s are"} ready to sync to origin/main.`
                : installedSha !== null && installedSha !== currentSha
                  ? "The installed app was built from an older source commit."
                  : undefined;
  const result: LiveForkUpdateResult = {
    status,
    branch,
    currentSha,
    upstreamSha,
    originSha,
    installedSha,
    ...divergence,
    localAheadOrigin,
    originAhead,
    mergeActive,
    dirtyFiles,
    conflictingFiles,
    ...(detail === undefined ? {} : { detail }),
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

  if (
    before.status === "unavailable" ||
    before.status === "needs_agent" ||
    before.status === "merge_conflict" ||
    before.status === "origin_diverged" ||
    before.status === "local_changes" ||
    before.status === "decision_required"
  ) {
    return before;
  }
  const fileSystem = yield* FileSystem.FileSystem;
  const rebuildLocked = yield* fileSystem
    .exists(REBUILD_LOCK_DIR)
    .pipe(Effect.orElseSucceed(() => false));
  if (rebuildLocked) {
    return {
      ...before,
      status: "unavailable",
      detail: "A T3 Code Live rebuild is in progress. Wait for it to finish before syncing source.",
    } satisfies LiveForkUpdateResult;
  }
  if (before.branch !== "main") {
    return {
      ...before,
      status: "needs_agent",
      detail: "The automatic updater only merges while the fork is on main.",
    } satisfies LiveForkUpdateResult;
  }
  let mergedUpstream = false;
  if (before.upstreamAhead > 0) {
    const mergeResult = yield* git.execute({
      operation: "LiveForkUpdater.mergeUpstream",
      cwd,
      args: ["merge", "--no-edit", UPSTREAM_REF],
      allowNonZeroExit: true,
      timeoutMs: 120_000,
    });
    const afterMerge = yield* inspect(cwd, { fetch: false });

    if (mergeResult.exitCode !== 0) {
      return {
        ...afterMerge.result,
        status:
          afterMerge.result.conflictingFiles.length > 0 ? "merge_conflict" : "needs_agent",
        detail:
          afterMerge.result.conflictingFiles.length > 0
            ? "The automatic merge stopped on conflicts. Start an agent to preserve registered fork features and finish the merge."
            : "Git could not complete the automatic merge. Start an agent to inspect and finish it safely.",
      } satisfies LiveForkUpdateResult;
    }
    mergedUpstream = true;
  }

  const beforePush = yield* inspect(cwd, { fetch: false });
  if (beforePush.result.originAhead > 0 || beforePush.result.conflictingFiles.length > 0) {
    return {
      ...beforePush.result,
      status:
        beforePush.result.originAhead > 0 ? "origin_diverged" : "merge_conflict",
      detail: "The fork cannot be fast-forwarded to origin/main without reconciliation.",
    } satisfies LiveForkUpdateResult;
  }

  let syncedOrigin = false;
  if (beforePush.result.localAheadOrigin > 0) {
    const pushResult = yield* git.execute({
      operation: "LiveForkUpdater.pushOrigin",
      cwd,
      args: ["push", "origin", "HEAD:main"],
      allowNonZeroExit: true,
      timeoutMs: 120_000,
    });
    if (pushResult.exitCode !== 0) {
      return {
        ...beforePush.result,
        status: "unavailable",
        detail:
          "The source merge completed, but origin/main could not be fast-forwarded. Retry the sync after checking GitHub authentication and connectivity.",
      } satisfies LiveForkUpdateResult;
    }
    syncedOrigin = true;
  }

  const after = yield* inspect(cwd, { fetch: syncedOrigin });
  if (
    after.result.originAhead > 0 ||
    after.result.localAheadOrigin > 0 ||
    after.result.currentSha !== after.result.originSha
  ) {
    return {
      ...after.result,
      status: "unavailable",
      detail: "origin/main did not match local main after the push completed.",
    } satisfies LiveForkUpdateResult;
  }

  if (!mergedUpstream && !syncedOrigin) return after.result;

  return {
    ...after.result,
    status: "merged",
    detail: `${
      mergedUpstream
        ? `Merged ${before.upstreamAhead} upstream commit${before.upstreamAhead === 1 ? "" : "s"}. `
        : ""
    }${syncedOrigin ? "Synced origin/main." : ""}`.trim(),
  } satisfies LiveForkUpdateResult;
});

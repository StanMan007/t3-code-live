import * as NodeOS from "node:os";

import {
  type GitCommandError,
  LiveForkRebuildError,
  type LiveForkRebuildResult,
} from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

const EXPECTED_UPSTREAM_URL = "https://github.com/pingdotgg/t3code.git";
const PRODUCT_NAME = "T3 Code Live (Nightly)";
const APP_ID = "com.stanman.t3codelive";
const SIGNING_IDENTITY = "Apple Development: Jonathan Stanley (P8U8347VLY)";
const isLiveForkRebuildError = Schema.is(LiveForkRebuildError);

export const REBUILD_SCRIPT = String.raw`set -euo pipefail

repo="$1"
log_path="$2"
log_dir="${"$"}{log_path%/*}"
lock_dir="${"$"}{TMPDIR:-/tmp}/t3-code-live-rebuild.lock"
lock_pid_path="$lock_dir/pid"
lock_owned=0
local_output_dir=""
stage_app=""
backup_app=""
target_app="/Applications/T3 Code Live (Nightly).app"
app_executable="$target_app/Contents/MacOS/T3 Code Live (Nightly)"
installed=0

mkdir -p "$log_dir"
exec >>"$log_path" 2>&1
printf '\n[%s] Starting T3 Code Live rebuild from %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$repo"

acquire_lock() {
  if mkdir "$lock_dir" 2>/dev/null; then
    printf '%s\n' "$$" >"$lock_pid_path"
    lock_owned=1
    return
  fi

  existing_pid="$(cat "$lock_pid_path" 2>/dev/null || true)"
  if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
    existing_command="$(ps -p "$existing_pid" -o command= 2>/dev/null || true)"
    if printf '%s' "$existing_command" | grep -Fq 't3-code-live-rebuild'; then
      printf 'A T3 Code Live rebuild is already running.\n'
      exit 75
    fi
  fi

  stale_lock="${"$"}{lock_dir}.stale.$$"
  if ! mv "$lock_dir" "$stale_lock" 2>/dev/null; then
    printf 'Another T3 Code Live rebuild acquired the lock.\n'
    exit 75
  fi
  rm -f "$stale_lock/pid"
  rmdir "$stale_lock" 2>/dev/null || true
  printf 'Recovered an abandoned T3 Code Live rebuild lock.\n'

  if ! mkdir "$lock_dir" 2>/dev/null; then
    printf 'Another T3 Code Live rebuild acquired the lock.\n'
    exit 75
  fi
  printf '%s\n' "$$" >"$lock_pid_path"
  lock_owned=1
}

acquire_lock

cleanup() {
  exit_status=$?
  if [ -n "$local_output_dir" ]; then
    case "$local_output_dir" in
      "${"$"}{TMPDIR:-/tmp}"/t3-code-live-output.*) rm -rf -- "$local_output_dir" ;;
    esac
  fi
  if [ "$installed" -eq 0 ] && [ -n "$backup_app" ] && [ -d "$backup_app" ] && [ ! -e "$target_app" ]; then
    mv "$backup_app" "$target_app" || true
    open -n "$target_app" || true
  fi
  if [ -n "$stage_app" ] && [ -d "$stage_app" ]; then
    mv "$stage_app" "${"$"}{TMPDIR:-/tmp}/T3 Code Live failed-stage-$$.app" || true
  fi
  if [ "$lock_owned" -eq 1 ] && [ "$(cat "$lock_pid_path" 2>/dev/null || true)" = "$$" ]; then
    rm -f "$lock_pid_path"
    rmdir "$lock_dir" 2>/dev/null || true
  fi
  if [ "$exit_status" -ne 0 ]; then
    printf '[%s] Rebuild failed with status %s. The running app was left unchanged.\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$exit_status"
  fi
  exit "$exit_status"
}
trap cleanup EXIT INT TERM

cd "$repo"
if [ "$(git symbolic-ref --quiet --short HEAD || true)" != "main" ]; then
  printf 'T3 Code Live can only rebuild from main.\n'
  exit 65
fi
if [ -n "$(git status --porcelain=v1)" ]; then
  printf 'T3 Code Live cannot rebuild from a dirty working tree.\n'
  exit 65
fi
source_sha="$(git rev-parse HEAD)"
if [ "$(git rev-parse origin/main)" != "$source_sha" ]; then
  printf 'T3 Code Live cannot rebuild until local main and origin/main match.\n'
  exit 65
fi
if ! git merge-base --is-ancestor upstream/main "$source_sha"; then
  printf 'T3 Code Live cannot rebuild until upstream/main is integrated.\n'
  exit 65
fi
local_output_dir="$(mktemp -d "${"$"}{TMPDIR:-/tmp}/t3-code-live-output.XXXXXX")"
T3CODE_DESKTOP_APP_ID='com.stanman.t3codelive' \
T3CODE_DESKTOP_PRODUCT_NAME='T3 Code Live (Nightly)' \
T3CODE_DESKTOP_ASSET_BRAND='nightly' \
T3CODE_DESKTOP_LOCAL_SIGN_IDENTITY='Apple Development: Jonathan Stanley (P8U8347VLY)' \
  ./node_modules/.bin/vp run dist:desktop:dir:arm64 --output-dir "$local_output_dir"

source_app="$local_output_dir/T3 Code Live (Nightly).app"
if [ ! -d "$source_app" ]; then
  printf 'The rebuilt application bundle could not be located.\n'
  exit 66
fi
if [ "$(plutil -extract CFBundleIdentifier raw "$source_app/Contents/Info.plist")" != 'com.stanman.t3codelive' ]; then
  printf 'The rebuilt app has an unexpected bundle identifier.\n'
  exit 65
fi
codesign --verify --deep --strict "$source_app"

stage_app="/Applications/.T3 Code Live (Nightly).app.new-$$"
ditto "$source_app" "$stage_app"
codesign --verify --deep --strict "$stage_app"

if [ "$(git rev-parse HEAD)" != "$source_sha" ] || [ -n "$(git status --porcelain=v1)" ]; then
  printf 'T3 Code Live source changed during the rebuild. The running app was left unchanged.\n'
  exit 75
fi
if [ "$(git rev-parse origin/main)" != "$source_sha" ]; then
  printf 'origin/main changed during the rebuild. The running app was left unchanged.\n'
  exit 75
fi

is_app_running() {
  ps -axo command= | grep -Fqx "$app_executable"
}

osascript -e 'tell application id "com.stanman.t3codelive" to quit' || true
for _ in {1..80}; do
  if ! is_app_running; then
    break
  fi
  sleep 0.25
done
if is_app_running; then
  printf 'T3 Code Live did not quit in time. The running app was left unchanged.\n'
  exit 75
fi

backup_app="${"$"}{TMPDIR:-/tmp}/T3 Code Live (Nightly).app.previous-$$"
if [ -d "$target_app" ]; then
  mv "$target_app" "$backup_app"
fi
mv "$stage_app" "$target_app"
stage_app=""
installed=1
reopened=0
for attempt in 1 2 3; do
  printf 'Opening rebuilt T3 Code Live (attempt %s of 3).\n' "$attempt"
  open -n "$target_app" || true
  for _ in {1..40}; do
    if is_app_running; then
      reopened=1
      break
    fi
    sleep 0.25
  done
  if [ "$reopened" -eq 1 ]; then
    break
  fi
done
if [ "$reopened" -ne 1 ]; then
  printf 'LaunchServices could not reopen the rebuilt app; trying its executable directly.\n'
  nohup "$app_executable" >/dev/null 2>&1 &
  for _ in {1..40}; do
    if is_app_running; then
      reopened=1
      break
    fi
    sleep 0.25
  done
fi
if [ "$reopened" -ne 1 ]; then
  failed_app="${"$"}{TMPDIR:-/tmp}/T3 Code Live failed-launch-$$.app"
  mv "$target_app" "$failed_app"
  mv "$backup_app" "$target_app"
  backup_app=""
  open -n "$target_app" || true
  printf 'The rebuilt app could not be reopened. The previous app was restored and a relaunch was requested. Failed bundle: %s\n' "$failed_app"
  exit 70
fi
if ! git update-ref refs/t3-code-live/installed "$source_sha"; then
  printf 'Warning: the installed-source marker could not be updated.\n'
fi
printf '[%s] Rebuild installed and verified running; T3 Code Live (Nightly) reopened. Previous bundle: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$backup_app"
`;

function rebuildError(cwd: string, detail: string, cause?: unknown): LiveForkRebuildError {
  return new LiveForkRebuildError({ cwd, detail, ...(cause === undefined ? {} : { cause }) });
}

export const start = Effect.fn("LiveForkRebuilder.start")(function* (
  cwd: string,
): Effect.fn.Return<
  LiveForkRebuildResult,
  LiveForkRebuildError | GitCommandError,
  GitVcsDriver.GitVcsDriver | ChildProcessSpawner.ChildProcessSpawner
> {
  const platform = yield* HostProcessPlatform;
  if (platform !== "darwin") {
    return yield* rebuildError(cwd, "The local signed rebuild control is available on macOS only.");
  }

  const git = yield* GitVcsDriver.GitVcsDriver;
  const upstream = yield* git.execute({
    operation: "LiveForkRebuilder.upstreamUrl",
    cwd,
    args: ["remote", "get-url", "upstream"],
    allowNonZeroExit: true,
  });
  if (upstream.exitCode !== 0 || upstream.stdout.trim() !== EXPECTED_UPSTREAM_URL) {
    return yield* rebuildError(cwd, `The upstream remote must be ${EXPECTED_UPSTREAM_URL}.`);
  }

  const logPath = `${NodeOS.homedir()}/Library/Logs/T3 Code Live/rebuild.log`;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const command = ChildProcess.make(
    "/bin/zsh",
    ["-c", REBUILD_SCRIPT, "t3-code-live-rebuild", cwd, logPath],
    {
      cwd,
      detached: true,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    },
  );

  yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(command);
      yield* Effect.sleep("750 millis");
      if (!(yield* handle.isRunning)) {
        const exitCode = yield* handle.exitCode;
        if (Number(exitCode) === 75) {
          return;
        }
        return yield* rebuildError(
          cwd,
          `The rebuild process exited before startup verification (status ${exitCode}).`,
        );
      }
      yield* handle.unref.pipe(Effect.asVoid);
    }),
  ).pipe(
    Effect.mapError((cause) =>
      isLiveForkRebuildError(cause)
        ? cause
        : rebuildError(cwd, "The rebuild process could not be started.", cause),
    ),
  );

  return { status: "started", logPath };
});

export const localBuildIdentity = {
  appId: APP_ID,
  productName: PRODUCT_NAME,
  signingIdentity: SIGNING_IDENTITY,
} as const;

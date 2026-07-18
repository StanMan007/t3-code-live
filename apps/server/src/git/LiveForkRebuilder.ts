import * as NodeOS from "node:os";

import {
  type GitCommandError,
  LiveForkRebuildError,
  type LiveForkRebuildResult,
} from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

const EXPECTED_UPSTREAM_URL = "https://github.com/pingdotgg/t3code.git";
const PRODUCT_NAME = "T3 Code Live (Nightly)";
const APP_ID = "com.stanman.t3codelive";
const SIGNING_IDENTITY = "Apple Development: Jonathan Stanley (P8U8347VLY)";

export const REBUILD_SCRIPT = String.raw`set -euo pipefail

repo="$1"
log_path="$2"
log_dir="${"$"}{log_path%/*}"
lock_dir="${"$"}{TMPDIR:-/tmp}/t3-code-live-rebuild.lock"
mount_dir=""
stage_app=""
backup_app=""
target_app="/Applications/T3 Code Live (Nightly).app"
installed=0

mkdir -p "$log_dir"
exec >>"$log_path" 2>&1
printf '\n[%s] Starting T3 Code Live rebuild from %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$repo"

if ! mkdir "$lock_dir" 2>/dev/null; then
  printf 'A T3 Code Live rebuild is already running.\n'
  exit 75
fi

cleanup() {
  status=$?
  if [ -n "$mount_dir" ] && mount | grep -Fq " on $mount_dir "; then
    hdiutil detach "$mount_dir" -quiet || true
  fi
  if [ "$installed" -eq 0 ] && [ -n "$backup_app" ] && [ -d "$backup_app" ] && [ ! -e "$target_app" ]; then
    mv "$backup_app" "$target_app" || true
    open "$target_app" || true
  fi
  if [ -n "$stage_app" ] && [ -d "$stage_app" ]; then
    mv "$stage_app" "${"$"}{TMPDIR:-/tmp}/T3 Code Live failed-stage-$$.app" || true
  fi
  rmdir "$lock_dir" 2>/dev/null || true
  if [ "$status" -ne 0 ]; then
    printf '[%s] Rebuild failed with status %s. The running app was left unchanged.\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$status"
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

cd "$repo"
T3CODE_DESKTOP_APP_ID='com.stanman.t3codelive' \
T3CODE_DESKTOP_PRODUCT_NAME='T3 Code Live (Nightly)' \
T3CODE_DESKTOP_LOCAL_SIGN_IDENTITY='Apple Development: Jonathan Stanley (P8U8347VLY)' \
  ./node_modules/.bin/vp run dist:desktop:dmg:arm64

dmg_path="$(find "$repo/release" -maxdepth 1 -type f -name 'T3-Code-*-arm64.dmg' -print0 | xargs -0 ls -t | head -n 1)"
if [ -z "$dmg_path" ] || [ ! -f "$dmg_path" ]; then
  printf 'The rebuilt DMG could not be located.\n'
  exit 66
fi

mount_dir="$(mktemp -d "${"$"}{TMPDIR:-/tmp}/t3-code-live-mount.XXXXXX")"
hdiutil attach "$dmg_path" -nobrowse -readonly -mountpoint "$mount_dir" -quiet
source_app="$mount_dir/T3 Code Live (Nightly).app"
if [ ! -d "$source_app" ]; then
  printf 'The DMG does not contain T3 Code Live (Nightly).app.\n'
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
hdiutil detach "$mount_dir" -quiet
rmdir "$mount_dir" 2>/dev/null || true
mount_dir=""

osascript -e 'tell application id "com.stanman.t3codelive" to quit' || true
for _ in {1..80}; do
  if ! pgrep -f '/Applications/T3 Code Live \(Nightly\)\.app/Contents/MacOS/T3 Code Live \(Nightly\)' >/dev/null; then
    break
  fi
  sleep 0.25
done

backup_app="${"$"}{TMPDIR:-/tmp}/T3 Code Live (Nightly).app.previous-$$"
if [ -d "$target_app" ]; then
  mv "$target_app" "$backup_app"
fi
mv "$stage_app" "$target_app"
stage_app=""
installed=1
open "$target_app"
printf '[%s] Rebuild installed; T3 Code Live (Nightly) reopened. Previous bundle: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$backup_app"
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

  yield* spawner.spawn(command).pipe(
    Effect.flatMap((handle) => handle.unref),
    Effect.asVoid,
    Effect.scoped,
    Effect.mapError((cause) =>
      rebuildError(cwd, "The rebuild process could not be started.", cause),
    ),
  );

  return { status: "started", logPath };
});

export const localBuildIdentity = {
  appId: APP_ID,
  productName: PRODUCT_NAME,
  signingIdentity: SIGNING_IDENTITY,
} as const;

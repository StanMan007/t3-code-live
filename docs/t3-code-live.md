# T3 Code Live integration

This fork adds a thread-scoped voice workbench, Claude workflow observability, guarded source updates, and small composer styling changes without replacing T3 Code's core thread model.

## Ownership boundary

- `LiveThreadControl.tsx` owns browser microphone capture, the WebRTC peer, transcript preview, and the explicit **Send to Codex** action.
- The realtime RPC contract carries only the authenticated SDP handshake. Audio, transcript events, and follow-up speech stay on the browser-managed WebRTC connection instead of passing through the T3 WebSocket.
- `realtimeBridge.ts` exchanges the offer against OpenAI's supported Realtime calls endpoint using `gpt-realtime-2.1`. It does not depend on Codex's gated experimental realtime feature or modify normal Codex thread creation.
- A handoff enters Codex through the existing composer `onSend` callback. No parallel turn runner or shadow thread state is introduced.
- Electron grants audio-only media permission to the trusted main renderer origin. Preview/browser partitions keep their existing deny-by-default policy.
- `liveForkFeatures.ts` is the preservation registry for intentional fork behavior. The merge-repair prompt treats those invariants as product requirements while allowing upstream structure to remain the baseline.

## Credential lookup

The backend resolves the Realtime API key without sending it to the renderer. Lookup order is:

1. `T3CODE_LIVE_THREAD_API_KEY`
2. `OPENAI_API_KEY`
3. the existing Live Thread macOS Keychain entry (`com.openai.live-thread` / `openai-api`)

This lets the fork reuse the already-configured Live Thread credential while keeping the packaged app independent from the plugin process.

## Updating from upstream

Keep `upstream` pointed at `pingdotgg/t3code` and merge upstream changes into this fork. Do not copy generated app-server code or fork the updater.

```sh
git fetch upstream
git merge upstream/main
git push origin HEAD:main
```

The sidebar's **Check for updates** control performs this as one guarded source-sync action. It
fetches both remotes, merges `upstream/main` when needed, and fast-forwards `origin/main`. It never
rebases or force-pushes. If Git reports conflicts, the repair agent receives the conflicting and
dirty file lists plus the fork feature registry. It finishes only the merge and its directly affected
focused test. It does not run lint, broad typechecks, broad tests, builds, or unrelated review. If
both implementations encode an incompatible product choice, the task stops with a recommended
two-choice decision instead of silently choosing one.

## New computer setup

The Git repository carries the fork implementation, preservation registry, updater prompt, tests, and
T3 Code Live documentation. Threads, provider sessions, credentials, Keychain entries, and
`~/.t3-live` remain local to each computer.

On a new computer, clone the writable fork and run the guarded setup script:

```sh
git clone https://github.com/StanMan007/t3-code-live.git
cd t3-code-live
./scripts/setup-t3-code-live-clone.sh --install
```

The script verifies that `origin` is the writable `StanMan007/t3-code-live` fork, adds or verifies
`upstream` as `pingdotgg/t3code`, disables pushes to `upstream`, fetches both `main` branches, and
optionally installs the locked dependencies. It refuses to rewrite unexpected remotes.

Authenticate GitHub, Claude, and Codex independently on the new computer. No account sessions,
tokens, `.env` files, application databases, or signing private keys belong in this repository.
Start the source checkout with `pnpm run dev:desktop`; use the in-app power control when the clean,
pushed source should become the installed Nightly app.

For ordinary two-computer work:

1. Begin from a clean checkout and run `git pull --ff-only origin main`.
2. Make and verify one cohesive change on one computer at a time.
3. Commit and push that change to `origin/main`.
4. Pull `origin/main` on the other computer before continuing there.
5. Use the guarded in-app updater on either computer to merge new `upstream/main` commits and
   fast-forward the fork.

Git synchronizes committed and pushed work. It does not synchronize uncommitted edits, running
processes, credentials, local threads, or an installed `.app`.

Source sync, local iteration, and signed installation are intentionally separate:

- The lightning control opens the checkout in hot-reload mode using the existing `dev:desktop`
  runner and the same `~/.t3-live` state. Renderer changes use Vite HMR. Desktop and server changes
  rebuild and restart only their process. The development window keeps the T3 Code Live Nightly
  branding so the fork-only controls remain available. It reuses the primary local task database;
  signed-app remote connection secrets remain sealed to the signed app. The first launch still
  performs one compile.
- The power control is the slower install lane. It builds, signs, replaces, verifies, and reopens the
  packaged Nightly app. Use this only when you want to prove or keep an installed `.app`.

The signed local path creates the unpacked `.app` directly; it does not generate release DMG or ZIP
archives. The rebuild records
`refs/t3-code-live/installed`; the updater uses that local ref to distinguish “source current” from
“installed app current.” A rebuild aborts rather than installing a stale package if `HEAD`, the
working tree, or `origin/main` changes while packaging is in progress.

The scheduled `upstream-compatibility.yml` workflow is an alert-only compatibility check. It reports
incoming commits and fails visibly when upstream advances; it cannot write repository contents and
does not open, merge, or publish a pull request. The guarded in-app updater owns source synchronization.

The preservation registry currently covers these intentional feature areas:

- Live Thread voice handoff
- guarded source update and local runtime controls
- Claude dynamic workflow observability
- composer surface styling

See `apps/web/src/components/settings/liveForkFeatures.ts` for the exact invariants, entry points, and
focused tests sent to the repair agent.

## Side-by-side Nightly build

Use a distinct bundle identifier and product name so the fork does not overwrite the official Nightly installation:

```sh
T3CODE_DESKTOP_APP_ID=com.stanman.t3codelive \
T3CODE_DESKTOP_PRODUCT_NAME='T3 Code Live (Nightly)' \
T3CODE_DESKTOP_LOCAL_SIGN_IDENTITY='Apple Development: Jonathan Stanley (P8U8347VLY)' \
vp run dist:desktop:dmg:arm64
```

The packaged product name is also embedded as the Electron runtime identity. The fork therefore uses `~/Library/Application Support/t3code-live` and `~/.t3-live` instead of upstream's profile, lock, and state directories. Both apps can be installed without either one replacing the other.

Use a stable local Apple Development identity for installed development builds.
Electron safe storage is backed by macOS Keychain; changing between ad-hoc
signatures can make Keychain treat each rebuilt binary as a new requester.
`T3CODE_DESKTOP_LOCAL_SIGN_IDENTITY` keeps the designated signing requirement
stable across local rebuilds. CI release signing remains on the existing
`--signed` path and is unaffected.

`T3CODE_DESKTOP_UPDATE_REPOSITORY` can point the packaged fork at its own GitHub release feed. When it is unset, local packages contain no update feed and cannot accidentally replace the integration with an official upstream binary. Upstream changes arrive through the guarded source updater; the scheduled workflow is only a notification backstop.

## Acceptance gate

1. Start or resume a Codex task.
2. Click the microphone in the composer and grant microphone access.
3. Speak through a task, then explicitly ask the voice model to prepare a handoff.
4. Review the handoff and click **Send to Codex**.
5. Confirm the normal T3 turn renders and its final assistant response is spoken into the still-active voice session.
6. Stop Live Thread and verify the microphone indicator clears.

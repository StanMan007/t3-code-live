# T3 Code Live integration

This fork adds a thread-scoped voice workbench without replacing T3 Code's thread, composer, provider, or updater behavior.

## Ownership boundary

- `LiveThreadControl.tsx` owns browser microphone capture, the WebRTC peer, transcript preview, and the explicit **Send to Codex** action.
- The realtime RPC contract carries only the authenticated SDP handshake. Audio, transcript events, and follow-up speech stay on the browser-managed WebRTC connection instead of passing through the T3 WebSocket.
- `realtimeBridge.ts` exchanges the offer against OpenAI's supported Realtime calls endpoint using `gpt-realtime-2.1`. It does not depend on Codex's gated experimental realtime feature or modify normal Codex thread creation.
- A handoff enters Codex through the existing composer `onSend` callback. No parallel turn runner or shadow thread state is introduced.
- Electron grants audio-only media permission to the trusted main renderer origin. Preview/browser partitions keep their existing deny-by-default policy.

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
rebases or force-pushes. If Git reports conflicts, the repair agent receives only the conflicted
files and finishes the merge without running lint, typecheck, tests, builds, or unrelated review.

Source sync and app installation are intentionally separate. After source and `origin/main` match,
the power control builds and installs that exact clean commit. This local-only path creates the
signed unpacked `.app` directly; it does not spend time generating release DMG or ZIP archives. The rebuild records
`refs/t3-code-live/installed`; the updater uses that local ref to distinguish “source current” from
“installed app current.” A rebuild aborts rather than installing a stale package if `HEAD`, the
working tree, or `origin/main` changes while packaging is in progress.

The scheduled `upstream-compatibility.yml` workflow opens a compatibility PR when upstream advances. It never merges or publishes automatically. Conflicts should normally be limited to these intentional seams:

- `apps/web/src/components/chat/ChatComposer.tsx`
- `apps/server/src/provider/realtimeBridge.ts`
- `apps/server/src/ws.ts`
- `packages/contracts/src/rpc.ts`
- `apps/desktop/src/window/DesktopWindow.ts`
- `scripts/build-desktop-artifact.ts`

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

`T3CODE_DESKTOP_UPDATE_REPOSITORY` can point the packaged fork at its own GitHub release feed. When it is unset, local packages contain no update feed and cannot accidentally replace the integration with an official upstream binary. Upstream changes arrive through the compatibility PR workflow, where the fork's full gate runs before a new package is built.

## Acceptance gate

1. Start or resume a Codex task.
2. Click the microphone in the composer and grant microphone access.
3. Speak through a task, then explicitly ask the voice model to prepare a handoff.
4. Review the handoff and click **Send to Codex**.
5. Confirm the normal T3 turn renders and its final assistant response is spoken into the still-active voice session.
6. Stop Live Thread and verify the microphone indicator clears.

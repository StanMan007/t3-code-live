export interface LiveForkFeatureContract {
  readonly id: string;
  readonly name: string;
  readonly invariants: ReadonlyArray<string>;
  readonly entrypoints: ReadonlyArray<string>;
  readonly focusedTests: ReadonlyArray<string>;
}

export const LIVE_FORK_FEATURES: ReadonlyArray<LiveForkFeatureContract> = [
  {
    id: "live-thread",
    name: "Live Thread",
    invariants: [
      "Keep the thread-scoped realtime voice panel and explicit Send to Codex handoff.",
      "Keep browser-owned WebRTC audio while normal Codex turns continue through the existing composer.",
      "Keep the authenticated realtime bridge and audio-only desktop permission boundary.",
    ],
    entrypoints: [
      "apps/web/src/components/chat/ChatComposer.tsx",
      "apps/server/src/provider/realtimeBridge.ts",
      "apps/server/src/ws.ts",
      "packages/contracts/src/rpc.ts",
      "apps/desktop/src/window/DesktopWindow.ts",
    ],
    focusedTests: [],
  },
  {
    id: "guarded-updater",
    name: "Guarded updater and local runtime",
    invariants: [
      "Keep upstream checks, normal merges, fast-forward origin sync, and explicit conflict handoff.",
      "Keep signed installation separate from source sync and refuse stale, dirty, or divergent installs.",
      "Keep the fast local development lane separate from the signed release-package lane.",
    ],
    entrypoints: [
      "apps/server/src/git/LiveForkUpdater.ts",
      "apps/server/src/git/LiveForkRebuilder.ts",
      "apps/web/src/components/sidebar/SidebarForkSourceUpdatePill.tsx",
      "apps/web/src/components/sidebar/SidebarLiveRebuildButton.tsx",
    ],
    focusedTests: [
      "apps/server/src/git/LiveForkUpdater.test.ts",
      "apps/server/src/git/LiveForkRebuilder.test.ts",
      "apps/web/src/components/settings/forkSourceUpdate.logic.test.ts",
      "apps/web/src/components/sidebar/SidebarForkSourceUpdatePill.logic.test.ts",
    ],
  },
  {
    id: "claude-workflow-observability",
    name: "Claude workflow observability",
    invariants: [
      "Keep Claude task lifecycle and workflow progress metadata in the typed runtime and orchestration path.",
      "Keep the Claude-only workflow run, phase, agent, timing, and usage navigator.",
      "Keep individual Claude workflow task stopping routed through the provider adapter.",
    ],
    entrypoints: [
      "apps/server/src/provider/Layers/ClaudeAdapter.ts",
      "apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts",
      "packages/contracts/src/providerRuntime.ts",
      "apps/web/src/claude-workflows.ts",
      "apps/web/src/components/chat/ClaudeWorkflowNavigator.tsx",
      "apps/web/src/components/ChatView.tsx",
    ],
    focusedTests: [
      "apps/web/src/claude-workflows.test.ts",
      "apps/server/src/provider/Layers/ClaudeAdapter.test.ts",
      "apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts",
    ],
  },
  {
    id: "composer-surface",
    name: "Composer surface styling",
    invariants: [
      "Keep the borderless composer in default and focused states.",
      "Keep the lighter opaque composer surface and opaque lower chrome without background bleed-through.",
    ],
    entrypoints: ["apps/web/src/index.css"],
    focusedTests: [],
  },
] as const;

export function formatLiveForkFeatureContracts(): string {
  return LIVE_FORK_FEATURES.map((feature) =>
    [
      `### ${feature.name} (${feature.id})`,
      ...feature.invariants.map((invariant) => `- ${invariant}`),
      `- Entry points: ${feature.entrypoints.map((path) => `\`${path}\``).join(", ")}`,
      feature.focusedTests.length > 0
        ? `- Focused tests: ${feature.focusedTests.map((path) => `\`${path}\``).join(", ")}`
        : "- Focused tests: none; use Git-only proof unless the conflict changes behavior.",
    ].join("\n"),
  ).join("\n\n");
}

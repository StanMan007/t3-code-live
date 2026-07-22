import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  buildLiveForkMergeRepairPrompt,
  findLiveForkSourceProject,
  LIVE_FORK_UPDATE_BLOCKED_MARKER,
  LIVE_FORK_UPDATE_READY_MARKER,
  resolveLiveForkUpdaterModelSelection,
} from "./forkSourceUpdate.logic";

const primaryEnvironmentId = EnvironmentId.make("primary");

function project(
  input: Pick<EnvironmentProject, "environmentId" | "workspaceRoot"> & Partial<EnvironmentProject>,
): EnvironmentProject {
  return {
    id: ProjectId.make(input.workspaceRoot),
    title: "Project",
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
    ...input,
  };
}

describe("findLiveForkSourceProject", () => {
  it("prefers the canonical fork remote on the primary environment", () => {
    const secondary = project({
      environmentId: EnvironmentId.make("secondary"),
      workspaceRoot: "/tmp/t3code",
    });
    const canonical = project({
      environmentId: primaryEnvironmentId,
      workspaceRoot: "/Users/example/Projects/t3-code-live",
      repositoryIdentity: {
        canonicalKey: "github.com/stanman007/t3-code-live",
        locator: {
          source: "git-remote",
          remoteName: "origin",
          remoteUrl: "https://github.com/StanMan007/t3-code-live.git",
        },
        owner: "StanMan007",
        name: "t3-code-live",
      },
    });

    expect(findLiveForkSourceProject([secondary, canonical], primaryEnvironmentId)).toBe(canonical);
  });

  it("falls back to a project whose workspace directory is t3code", () => {
    const source = project({
      environmentId: primaryEnvironmentId,
      workspaceRoot: "C:\\Projects\\t3code\\",
    });

    expect(findLiveForkSourceProject([source], primaryEnvironmentId)).toBe(source);
  });
});

describe("buildLiveForkMergeRepairPrompt", () => {
  it("limits conflict repair to the reported files and Git-only completion proof", () => {
    const prompt = buildLiveForkMergeRepairPrompt({
      workspaceRoot: "/Users/example/t3code",
      installedVersion: "0.0.29-nightly.1",
      updateResult: {
        status: "needs_agent",
        branch: "main",
        currentSha: "abc123",
        upstreamSha: "def456",
        localAhead: 5,
        upstreamAhead: 2,
        conflictingFiles: ["apps/web/src/components/chat/ChatComposer.tsx"],
        detail: "The automatic merge stopped on conflicts.",
      },
    });

    expect(prompt).toContain("/Users/example/t3code");
    expect(prompt).toContain("0.0.29-nightly.1");
    expect(prompt).toContain("never rebase, reset, force-push");
    expect(prompt).toContain("ChatComposer.tsx");
    expect(prompt).toContain("Live Thread, its real-time agent/right-panel integration");
    expect(prompt).toContain("Upstream T3 Code is the source of truth");
    expect(prompt).toContain("inspect only the reported conflicted files");
    expect(prompt).toContain("Retain upstream's current implementation");
    expect(prompt).toContain("finish the existing merge with hooks disabled");
    expect(prompt).toContain("Do not run lint, formatting, typecheck, tests, builds");
    expect(prompt).toContain("Do not run code-quality or runtime checks");
    expect(prompt).not.toContain("./node_modules/.bin/vp check");
    expect(prompt).not.toContain("concurrency-limit");
    expect(prompt).not.toContain("broader tests");
    expect(prompt).toContain("use the T3 Code Live power button once");
    expect(prompt).toContain(LIVE_FORK_UPDATE_READY_MARKER);
    expect(prompt).toContain(LIVE_FORK_UPDATE_BLOCKED_MARKER);
    expect(prompt).toContain("Never emit the ready marker for a partial");
  });

  it("does not mislabel a dirty worktree as a merge conflict", () => {
    const prompt = buildLiveForkMergeRepairPrompt({
      workspaceRoot: "/Users/example/t3code",
      installedVersion: "0.0.28",
      updateResult: {
        status: "needs_agent",
        branch: "main",
        currentSha: "abc123",
        upstreamSha: "def456",
        localAhead: 5,
        upstreamAhead: 18,
        conflictingFiles: [],
        detail:
          "The fork has local changes. An agent should preserve them before merging upstream.",
      },
    });

    expect(prompt).toContain("uncommitted local fork changes; no merge has started");
    expect(prompt).toContain("None reported. Do not assume that a merge is active.");
    expect(prompt).toContain("inspect only the blocking files");
    expect(prompt).toContain("git merge --no-edit upstream/main");
    expect(prompt).not.toContain("Resolve the existing upstream merge conflicts");
  });
});

describe("resolveLiveForkUpdaterModelSelection", () => {
  function provider(models: ServerProvider["models"]): ServerProvider {
    return {
      instanceId: ProviderInstanceId.make("codex"),
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-07-17T00:00:00.000Z",
      availability: "available",
      models,
      slashCommands: [],
      skills: [],
    };
  }

  it("selects GPT-5.6-Sol with High reasoning", () => {
    const selection = resolveLiveForkUpdaterModelSelection({
      providers: [
        provider([
          {
            slug: "gpt-5.4",
            name: "GPT-5.4",
            isCustom: false,
            capabilities: null,
          },
          {
            slug: "gpt-5.6-sol",
            name: "GPT-5.6-Sol",
            isCustom: false,
            capabilities: {
              optionDescriptors: [
                {
                  id: "reasoningEffort",
                  label: "Reasoning",
                  type: "select",
                  options: [
                    { id: "low", label: "Low" },
                    { id: "high", label: "High" },
                    { id: "xhigh", label: "Extra High" },
                  ],
                  currentValue: "low",
                },
              ],
            },
          },
        ]),
      ],
      projectDefaultModelSelection: null,
    });

    expect(selection).toEqual({
      instanceId: "codex",
      model: "gpt-5.6-sol",
      options: [{ id: "reasoningEffort", value: "high" }],
    });
  });

  it("refuses to launch when no GPT-5.6 model is available", () => {
    expect(
      resolveLiveForkUpdaterModelSelection({
        providers: [
          provider([
            {
              slug: "gpt-5.4",
              name: "GPT-5.4",
              isCustom: false,
              capabilities: null,
            },
          ]),
        ],
        projectDefaultModelSelection: null,
      }),
    ).toBeNull();
  });

  it("refuses to launch when GPT-5.6 cannot be pinned to High reasoning", () => {
    expect(
      resolveLiveForkUpdaterModelSelection({
        providers: [
          provider([
            {
              slug: "gpt-5.6-sol",
              name: "GPT-5.6-Sol",
              isCustom: false,
              capabilities: {
                optionDescriptors: [
                  {
                    id: "reasoningEffort",
                    label: "Reasoning",
                    type: "select",
                    options: [{ id: "xhigh", label: "Extra High" }],
                    currentValue: "xhigh",
                  },
                ],
              },
            },
          ]),
        ],
        projectDefaultModelSelection: null,
      }),
    ).toBeNull();
  });
});

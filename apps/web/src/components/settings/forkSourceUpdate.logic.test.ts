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
  buildLiveForkUpdatePrompt,
  findLiveForkSourceProject,
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

describe("buildLiveForkUpdatePrompt", () => {
  it("includes the repository, safety boundaries, proof gates, and custom identity", () => {
    const prompt = buildLiveForkUpdatePrompt({
      workspaceRoot: "/Users/example/t3code",
      installedVersion: "0.0.29-nightly.1",
    });

    expect(prompt).toContain("/Users/example/t3code");
    expect(prompt).toContain("0.0.29-nightly.1");
    expect(prompt).toContain("Never rebase, reset, force-push");
    expect(prompt).toContain("branch is not `main`");
    expect(prompt).toContain("git merge --no-edit upstream/main");
    expect(prompt).toContain("com.stanman.t3codelive");
    expect(prompt).toContain('report "already current"');
    expect(prompt).toContain("Do not test or build");
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

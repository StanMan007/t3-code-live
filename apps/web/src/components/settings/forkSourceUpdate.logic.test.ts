import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { buildLiveForkUpdatePrompt, findLiveForkSourceProject } from "./forkSourceUpdate.logic";

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
    expect(prompt).toContain("Never reset, rebase, force-push");
    expect(prompt).toContain("merge upstream/main");
    expect(prompt).toContain("com.stanman.t3codelive");
    expect(prompt).toContain("Use Computer Use");
  });
});

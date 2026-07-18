import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  ModelSelection,
  ProviderOptionSelection,
  ServerProvider,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

const LIVE_FORK_OWNER = "stanman007";
const LIVE_FORK_REPOSITORY = "t3-code-live";
const PREFERRED_UPDATE_MODELS = ["gpt-5.6-sol", "gpt-5.6"] as const;
const PREFERRED_REASONING_VALUES = ["xhigh", "max", "high"] as const;

type ForkUpdateProvider = Pick<
  ServerProvider,
  "availability" | "driver" | "enabled" | "installed" | "instanceId" | "models" | "status"
>;

function normalizedPathBasename(workspaceRoot: string): string {
  return (
    workspaceRoot
      .replace(/[\\/]+$/u, "")
      .split(/[\\/]/u)
      .at(-1)
      ?.toLowerCase() ?? ""
  );
}

function isLiveForkRepository(project: EnvironmentProject): boolean {
  const owner = project.repositoryIdentity?.owner?.toLowerCase();
  const name = project.repositoryIdentity?.name?.toLowerCase();
  if (owner === LIVE_FORK_OWNER && name === LIVE_FORK_REPOSITORY) {
    return true;
  }

  const remoteUrl = project.repositoryIdentity?.locator.remoteUrl.toLowerCase() ?? "";
  return remoteUrl.includes(`${LIVE_FORK_OWNER}/${LIVE_FORK_REPOSITORY}`);
}

export function findLiveForkSourceProject(
  projects: ReadonlyArray<EnvironmentProject>,
  primaryEnvironmentId: EnvironmentId | null,
): EnvironmentProject | null {
  const ranked = projects
    .filter(
      (project) =>
        isLiveForkRepository(project) || normalizedPathBasename(project.workspaceRoot) === "t3code",
    )
    .map((project) => ({
      project,
      score:
        (isLiveForkRepository(project) ? 4 : 0) +
        (project.environmentId === primaryEnvironmentId ? 2 : 0) +
        (normalizedPathBasename(project.workspaceRoot) === "t3code" ? 1 : 0),
    }))
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.project ?? null;
}

function withStrongReasoning(
  selection: ModelSelection,
  providerModel: ForkUpdateProvider["models"][number] | null,
): ModelSelection {
  const descriptors = providerModel?.capabilities?.optionDescriptors ?? [];
  const reasoningDescriptor = descriptors.find((descriptor) => descriptor.id === "reasoningEffort");
  const reasoningOptions =
    reasoningDescriptor?.type === "select" ? reasoningDescriptor.options : [];
  const reasoningValue =
    PREFERRED_REASONING_VALUES.find((candidate) =>
      reasoningOptions.some((option) => option.id === candidate),
    ) ?? "xhigh";
  const options: ProviderOptionSelection[] = [
    ...(selection.options?.filter((option) => option.id !== "reasoningEffort") ?? []),
    { id: "reasoningEffort", value: reasoningValue },
  ];

  return createModelSelection(selection.instanceId, selection.model, options);
}

export function resolveLiveForkUpdaterModelSelection(input: {
  readonly providers: ReadonlyArray<ForkUpdateProvider>;
  readonly projectDefaultModelSelection: ModelSelection | null;
}): ModelSelection | null {
  const availableCodexProviders = input.providers.filter(
    (provider) =>
      provider.driver === "codex" &&
      provider.enabled &&
      provider.installed &&
      provider.availability !== "unavailable" &&
      provider.status !== "error" &&
      provider.status !== "disabled",
  );

  for (const preferredModel of PREFERRED_UPDATE_MODELS) {
    for (const provider of availableCodexProviders) {
      const model = provider.models.find(
        (candidate) => candidate.slug.toLowerCase() === preferredModel,
      );
      if (model) {
        return withStrongReasoning(createModelSelection(provider.instanceId, model.slug), model);
      }
    }
  }

  const projectDefault = input.projectDefaultModelSelection;
  if (projectDefault?.model.toLowerCase().startsWith("gpt-5.6")) {
    const providerModel = input.providers
      .find((provider) => provider.instanceId === projectDefault.instanceId)
      ?.models.find((model) => model.slug === projectDefault.model);
    return withStrongReasoning(projectDefault, providerModel ?? null);
  }

  return null;
}

export function buildLiveForkUpdatePrompt(input: {
  readonly workspaceRoot: string;
  readonly installedVersion: string;
}): string {
  return `Update and verify my local T3 Code Live fork at ${input.workspaceRoot}.

This task was launched by the in-app one-click updater. The currently installed custom app reports version ${input.installedVersion}.

Required safety contract:
- Read AGENTS.md and inspect the repository, branch, remotes, status, and recent history before changing anything.
- Treat pingdotgg/t3code upstream/main as the upstream source and StanMan007/t3-code-live as the custom fork. Confirm those remotes from Git before relying on them.
- Never reset, rebase, force-push, discard, overwrite, or automatically stash local work. If the working tree has unrelated or uncommitted user work, stop and explain exactly what must be resolved.
- Do not create or switch branches or worktrees. Do not push, open a PR, publish a release, or replace the installed app unless I explicitly authorize that action in this task.
- Preserve the Live Thread integration and this one-click updater as a thin additive layer. Do not copy an upstream app bundle over the custom app.

Update workflow:
1. Fetch origin and upstream with pruning, then report whether upstream/main is ahead and list the incoming commits.
2. If already current, skip the merge and continue to verification. Otherwise merge upstream/main into the current branch with a normal merge commit; never rebase.
3. Resolve only clear, narrow conflicts while preserving both upstream behavior and the additive Live Thread/updater seams. If a conflict requires product judgment, stop and ask.
4. Run the repository's current formatter/check, typecheck, focused Live Thread/updater tests, and the relevant broader test suite. Fix regressions caused by the integration.
5. Build the custom macOS arm64 DMG using the current repository build workflow with these custom identity values:
   - app id: com.stanman.t3codelive
   - product name: T3 Code Live (Nightly)
   - signing identity: Apple Development: Jonathan Stanley (P8U8347VLY)
6. Verify the built app name, version, architecture, code signature, DMG checksum, and that it launches without replacing the installed app.
7. Use Computer Use to prove the updated UI, including Live Thread and Settings > About > Update T3 Code Live.

Finish with a concise evidence report: old and new upstream SHAs, merge result, preserved custom files, commands and results, artifact path and checksum, screenshot path, and whether the installed app still needs an explicitly approved replacement/restart.`;
}

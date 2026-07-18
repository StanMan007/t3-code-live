import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  LiveForkUpdateResult,
  ModelSelection,
  ProviderOptionSelection,
  ServerProvider,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

const LIVE_FORK_OWNER = "stanman007";
const LIVE_FORK_REPOSITORY = "t3-code-live";
const PREFERRED_UPDATE_MODELS = ["gpt-5.6-sol", "gpt-5.6"] as const;

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

function withHighReasoning(
  selection: ModelSelection,
  providerModel: ForkUpdateProvider["models"][number] | null,
): ModelSelection | null {
  const descriptors = providerModel?.capabilities?.optionDescriptors ?? [];
  const reasoningDescriptor = descriptors.find((descriptor) => descriptor.id === "reasoningEffort");
  const reasoningOptions =
    reasoningDescriptor?.type === "select" ? reasoningDescriptor.options : [];
  const reasoningValue = reasoningOptions.some((option) => option.id === "high") ? "high" : null;
  if (reasoningValue === null) {
    return null;
  }
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
        const selection = withHighReasoning(
          createModelSelection(provider.instanceId, model.slug),
          model,
        );
        if (selection) {
          return selection;
        }
      }
    }
  }

  const projectDefault = input.projectDefaultModelSelection;
  if (projectDefault?.model.toLowerCase().startsWith("gpt-5.6")) {
    const providerModel = input.providers
      .find((provider) => provider.instanceId === projectDefault.instanceId)
      ?.models.find((model) => model.slug === projectDefault.model);
    return withHighReasoning(projectDefault, providerModel ?? null);
  }

  return null;
}

export function buildLiveForkMergeRepairPrompt(input: {
  readonly workspaceRoot: string;
  readonly installedVersion: string;
  readonly updateResult: LiveForkUpdateResult;
}): string {
  const conflictSummary =
    input.updateResult.conflictingFiles.length > 0
      ? input.updateResult.conflictingFiles.map((file) => `  - ${file}`).join("\n")
      : "  - Git did not report specific unmerged files; inspect the repository state.";

  return `Finish the interrupted T3 Code Live upstream update at ${input.workspaceRoot}.

Installed version: ${input.installedVersion}. Use the assigned GPT-5.6-Sol model on High reasoning.
Automatic updater detail: ${input.updateResult.detail ?? "The automatic merge needs assistance."}

Conflicting or blocked files:
${conflictSummary}

Rules:
- Read AGENTS.md. Work only in the current checkout and branch.
- Preserve exactly one fork feature: the Live Thread real-time agent and its guarded updater. Keep it additive over upstream T3 Code behavior.
- Never rebase, reset, force-push, discard, abort the merge, or automatically stash work.
- Never push, open a PR, publish, build, install, or replace the app without explicit approval in this task.

Run this repair flow:
1. Inspect \`git status --short --branch\`, \`git diff --name-only --diff-filter=U\`, and the current merge state.
2. Resolve the existing upstream merge conflicts. Prefer upstream behavior everywhere except the intentional Live Thread integration seams documented in \`docs/t3-code-live.md\`.
3. Stage the resolved files and finish the merge commit. Do not rewrite existing history.
4. Run:
   - \`./node_modules/.bin/vp check\`
   - \`./node_modules/.bin/vp run -r --concurrency-limit 2 typecheck\`
   - the focused Live Thread and updater tests, followed by broader tests only when the changed surface warrants them.

Finish with: conflicts resolved, Live Thread preservation evidence, checks run, and the one next action required from me.`;
}

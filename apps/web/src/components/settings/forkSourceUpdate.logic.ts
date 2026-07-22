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
export const LIVE_FORK_UPDATE_READY_MARKER = "T3_CODE_LIVE_UPDATE_READY";
export const LIVE_FORK_UPDATE_BLOCKED_MARKER = "T3_CODE_LIVE_UPDATE_BLOCKED";

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
  const hasMergeConflicts = input.updateResult.conflictingFiles.length > 0;
  const hasDirtyWorktreeBlocker =
    !hasMergeConflicts &&
    input.updateResult.detail?.toLowerCase().includes("local changes") === true;
  const blockerKind = hasMergeConflicts
    ? "active merge conflicts"
    : hasDirtyWorktreeBlocker
      ? "uncommitted local fork changes; no merge has started"
      : "Git needs inspection before the upstream merge can continue";
  const conflictSummary = hasMergeConflicts
    ? input.updateResult.conflictingFiles.map((file) => `  - ${file}`).join("\n")
    : "  - None reported. Do not assume that a merge is active.";

  return `Finish the T3 Code Live upstream merge in the existing fork at ${input.workspaceRoot}.

Installed version: ${input.installedVersion}. Use the assigned GPT-5.6-Sol model on High reasoning.
Target: merge \`upstream/main\` (${input.updateResult.upstreamSha ?? "unknown SHA"}) into the current \`${input.updateResult.branch ?? "unknown"}\` branch at ${input.updateResult.currentSha ?? "unknown SHA"}.
Divergence reported by the updater: ${input.updateResult.localAhead} local commit(s), ${input.updateResult.upstreamAhead} upstream commit(s).
Updater blocker: ${blockerKind}.
Updater detail: ${input.updateResult.detail ?? "The automatic merge needs assistance."}

Reported unmerged files:
${conflictSummary}

Primary objective:
- Resolve only the reported Git blocker and finish the normal merge.
- Upstream T3 Code is the source of truth. Preserve only the smallest documented Live Thread, its real-time agent/right-panel integration, updater, or rebuilder seam needed in each conflicted file.
- Prefer upstream everywhere else. Do not audit, refactor, or improve unrelated code.

Safety rules:
- Read AGENTS.md. Work only in the current checkout and branch.
- Use a normal merge; never rebase, reset, force-push, discard, automatically stash, or rewrite existing history.
- Do not resolve a conflict by blindly taking an entire \`ours\` file. Retain upstream's current implementation and reapply only the smallest required Live Thread seam.
- If unrelated user work is mixed into the dirty tree or a conflict requires product judgment, stop and report the exact files and decision needed. Do not hide the problem in the update commit.
- Do not run lint, formatting, typecheck, tests, builds, dev servers, packaging, installation, or UI verification. Do not push, open a PR, or publish.

Minimal repair flow:
1. Confirm the current branch, \`MERGE_HEAD\`, \`git status --short --branch\`, and \`git diff --name-only --diff-filter=U\`. Confirm \`upstream\` is \`https://github.com/pingdotgg/t3code.git\`.
2. If a merge is active, inspect only the reported conflicted files and their three Git stages. Keep upstream's implementation and reapply only the minimal documented fork seam. Stage only those resolutions and finish the existing merge with hooks disabled.
3. If no merge is active, do not invent one. If the tree is clean, run the normal \`git merge --no-edit upstream/main\`. If local work blocks the merge, inspect only the blocking files; preserve a clearly documented fork seam, otherwise stop and report the exact decision needed.
4. Perform Git-only completion proof: no unmerged paths, no active \`MERGE_HEAD\`, \`git merge-base --is-ancestor upstream/main HEAD\` succeeds, and the working tree is clean. Do not run code-quality or runtime checks.

Final response contract:
- Report only the files that conflicted, the narrow resolution applied to each, and the Git-only completion proof.
- End with \`${LIVE_FORK_UPDATE_READY_MARKER}\` on its own line only if upstream ancestry, merge-complete, and clean-tree proof pass.
- Otherwise end with \`${LIVE_FORK_UPDATE_BLOCKED_MARKER}\` on its own line and explain the exact blocker. Never emit the ready marker for a partial, interrupted, or dirty update.

Finish with this explicit next action: use the T3 Code Live power button once to rebuild, replace, and relaunch the packaged app. A source merge alone does not update the running app.`;
}

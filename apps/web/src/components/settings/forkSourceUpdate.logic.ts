import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  LiveForkUpdateResult,
  ModelSelection,
  ProviderOptionSelection,
  ServerProvider,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import { formatLiveForkFeatureContracts } from "./liveForkFeatures";

const LIVE_FORK_OWNER = "stanman007";
const LIVE_FORK_REPOSITORY = "t3-code-live";
const PREFERRED_UPDATE_MODELS = ["gpt-5.6-sol", "gpt-5.6"] as const;
export const LIVE_FORK_UPDATE_READY_MARKER = "T3_CODE_LIVE_UPDATE_READY";
export const LIVE_FORK_UPDATE_BLOCKED_MARKER = "T3_CODE_LIVE_UPDATE_BLOCKED";
export const LIVE_FORK_UPDATE_DECISION_REQUIRED_MARKER =
  "T3_CODE_LIVE_UPDATE_DECISION_REQUIRED";

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
  const blockerKind =
    input.updateResult.status === "merge_conflict"
      ? "active merge conflicts"
      : input.updateResult.status === "local_changes"
        ? "uncommitted local fork changes; no merge has started"
        : input.updateResult.status === "origin_diverged"
          ? "origin/main contains commits missing from local main"
          : input.updateResult.mergeActive
            ? "an active merge needs inspection"
            : "Git needs inspection before the upstream merge can continue";
  const conflictSummary = input.updateResult.conflictingFiles.length > 0
    ? input.updateResult.conflictingFiles.map((file) => `  - ${file}`).join("\n")
    : "  - None reported. Do not assume that a merge is active.";
  const dirtySummary =
    input.updateResult.dirtyFiles.length > 0
      ? input.updateResult.dirtyFiles.map((file) => `  - ${file}`).join("\n")
      : "  - None reported.";

  return `Finish the T3 Code Live upstream merge in the existing fork at ${input.workspaceRoot}.

Installed version: ${input.installedVersion}. Use the assigned GPT-5.6-Sol model on High reasoning.
Target: merge \`upstream/main\` (${input.updateResult.upstreamSha ?? "unknown SHA"}) into the current \`${input.updateResult.branch ?? "unknown"}\` branch at ${input.updateResult.currentSha ?? "unknown SHA"}.
Divergence reported by the updater: ${input.updateResult.localAhead} local commit(s), ${input.updateResult.upstreamAhead} upstream commit(s).
Updater blocker: ${blockerKind}.
Updater detail: ${input.updateResult.detail ?? "The automatic merge needs assistance."}

Reported unmerged files:
${conflictSummary}

Reported dirty files:
${dirtySummary}

Primary objective:
- Resolve only the reported Git blocker, preserve intentional fork behavior, and finish the normal merge or sync.
- Upstream T3 Code is the structural baseline. The registered fork features below are product requirements.
- Adopt upstream's current structure everywhere it can satisfy the registered behavior. Never retain an entire fork file merely because it is ours.

Registered fork feature contracts:
${formatLiveForkFeatureContracts()}

Safety rules:
- Read AGENTS.md. Work only in the current checkout and branch.
- Use a normal merge; never rebase, reset, force-push, discard, automatically stash, or rewrite existing history.
- Inspect base, ours, and theirs for every conflicted file. Retain upstream's implementation and reapply the smallest registered feature seam.
- If dirty work is cohesive and clearly implements a registered feature or the user's stated local change, checkpoint it as one narrow commit before syncing. If it is mixed, incomplete, secret-bearing, or ambiguous, request a decision instead.
- The T3 Code Dev app, Electron, its local server, \`vp ... dev\`, and \`vp pack --watch\` are the expected read/watch runtime that invoked this workflow. Do not classify them as competing source writers or stop them merely because they are running. Block only on concrete evidence that a separate process is mutating tracked source files or Git index/refs, such as an active Git lock, package install, formatter, or another editing agent.
- Do not run lint, formatting, broad typecheck/tests, builds, dev servers, packaging, installation, or UI verification. If a conflict changes a registered feature, run only its listed focused test when that test is narrow enough to complete quickly.
- Do not push, open a PR, or publish. The updater performs the verified fast-forward push after the agent finishes.

Minimal repair flow:
1. Confirm the current branch, \`MERGE_HEAD\`, Git index lock state, \`git status --short --branch\`, and \`git diff --name-only --diff-filter=U\`. Confirm both canonical remotes. Expected T3 Code Dev watch/runtime processes are not a blocker by themselves.
2. If a merge is active, inspect the reported conflicted files and their three Git stages. Combine upstream structure with the registered behavior, stage only the resolutions, and finish the existing merge.
3. If no merge is active and the tree is dirty, classify the reported dirty paths. Checkpoint one cohesive intentional feature, or request a decision when intent is ambiguous. Never auto-stash or discard it.
4. Once the tree is clean, run \`git merge --no-edit upstream/main\` only when upstream is ahead. Do not invent a merge when upstream is already an ancestor.
5. Perform Git-only completion proof: no unmerged paths, no active \`MERGE_HEAD\`, \`git merge-base --is-ancestor upstream/main HEAD\` succeeds, and the working tree is clean.

Final response contract:
- Report the blocker files, the narrow resolution or checkpoint applied, and the Git-only completion proof.
- End with \`${LIVE_FORK_UPDATE_READY_MARKER}\` on its own line only if upstream ancestry, merge-complete, and clean-tree proof pass.
- If a real product decision is required, end with \`${LIVE_FORK_UPDATE_DECISION_REQUIRED_MARKER}\` and provide two concrete choices, the behavioral impact of each, and your recommendation. Do not use this for mechanical Git conflicts.
- Otherwise end with \`${LIVE_FORK_UPDATE_BLOCKED_MARKER}\` on its own line and explain the exact blocker. Never emit the ready marker for a partial, interrupted, or dirty update.

Finish with this explicit next action: use the T3 Code Live power button once to rebuild, replace, and relaunch the packaged app. A source merge alone does not update the running app.`;
}

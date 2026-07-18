import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { LiveForkUpdateResult } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  BotIcon,
  CircleCheckIcon,
  DownloadIcon,
  LoaderIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { APP_BASE_NAME, APP_VERSION } from "../../branding";
import { useProjects } from "../../state/entities";
import { usePrimaryEnvironment } from "../../state/environments";
import { liveForkUpdateEnvironment } from "../../state/liveForkUpdate";
import { primaryServerProvidersAtom } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { newMessageId, newThreadId } from "../../lib/utils";
import {
  buildLiveForkMergeRepairPrompt,
  findLiveForkSourceProject,
  resolveLiveForkUpdaterModelSelection,
} from "../settings/forkSourceUpdate.logic";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  getForkUpdatePillView,
  type ForkUpdatePillPhase,
} from "./SidebarForkSourceUpdatePill.logic";

const CHECK_INTERVAL_MS = 15 * 60_000;

const TONE_STYLES = {
  neutral:
    "text-muted-foreground/70 group-has-[button.fork-update-main:hover]/fork-update:bg-accent group-has-[button.fork-update-main:hover]/fork-update:text-foreground",
  primary:
    "bg-primary/15 text-primary group-has-[button.fork-update-main:hover]/fork-update:bg-primary/22",
  warning:
    "bg-warning/14 text-warning group-has-[button.fork-update-main:hover]/fork-update:bg-warning/20",
  success:
    "bg-success/12 text-success group-has-[button.fork-update-main:hover]/fork-update:bg-success/18",
} as const;

export function SidebarForkSourceUpdatePill() {
  const navigate = useNavigate();
  const primaryEnvironment = usePrimaryEnvironment();
  const projects = useProjects();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const checkUpdate = useAtomCommand(liveForkUpdateEnvironment.check, { reportFailure: false });
  const mergeUpdate = useAtomCommand(liveForkUpdateEnvironment.merge, { reportFailure: false });
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const startThreadTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const [result, setResult] = useState<LiveForkUpdateResult | null>(null);
  const [phase, setPhase] = useState<ForkUpdatePillPhase>("idle");
  const [dismissedSha, setDismissedSha] = useState<string | null>(null);
  const sourceProject = useMemo(
    () => findLiveForkSourceProject(projects, primaryEnvironment?.environmentId ?? null),
    [primaryEnvironment?.environmentId, projects],
  );
  const updaterModelSelection = useMemo(
    () =>
      resolveLiveForkUpdaterModelSelection({
        providers,
        projectDefaultModelSelection: sourceProject?.defaultModelSelection ?? null,
      }),
    [providers, sourceProject?.defaultModelSelection],
  );

  const runCheck = useCallback(
    async (showProgress: boolean) => {
      if (APP_BASE_NAME !== "T3 Code Live" || !sourceProject) return;
      if (showProgress) setPhase("checking");
      const checkResult = await checkUpdate({
        environmentId: sourceProject.environmentId,
        input: { cwd: sourceProject.workspaceRoot },
      });
      if (checkResult._tag === "Success") {
        setResult(checkResult.value);
      }
      if (showProgress) setPhase("idle");
    },
    [checkUpdate, sourceProject],
  );

  useEffect(() => {
    void runCheck(true);
    const intervalId = window.setInterval(() => void runCheck(false), CHECK_INTERVAL_MS);
    const handleFocus = () => void runCheck(false);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, [runCheck]);

  useEffect(() => {
    if (result?.status !== "merged") return;
    const timeoutId = window.setTimeout(() => setResult(null), 8_000);
    return () => window.clearTimeout(timeoutId);
  }, [result]);

  const launchRepairAgent = useCallback(async () => {
    if (!sourceProject || !result || !updaterModelSelection || phase !== "idle") return;
    const createdAt = new Date().toISOString();
    const threadId = newThreadId();
    const title = "Resolve T3 Code Live upstream merge";
    const prompt = buildLiveForkMergeRepairPrompt({
      workspaceRoot: sourceProject.workspaceRoot,
      installedVersion: APP_VERSION,
      updateResult: result,
    });
    setPhase("launching_agent");

    const createResult = await createThread({
      environmentId: sourceProject.environmentId,
      input: {
        threadId,
        projectId: sourceProject.id,
        title,
        modelSelection: updaterModelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt,
      },
    });
    let failure: AtomCommandResult<unknown, unknown> | null =
      createResult._tag === "Failure" ? createResult : null;

    if (failure === null) {
      const startResult = await startThreadTurn({
        environmentId: sourceProject.environmentId,
        input: {
          threadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: prompt,
            attachments: [],
          },
          modelSelection: updaterModelSelection,
          titleSeed: title,
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt,
        },
      });
      failure = startResult._tag === "Failure" ? startResult : null;
    }

    if (failure === null) {
      const navigateResult = await settlePromise(() =>
        navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId: sourceProject.environmentId, threadId },
        }),
      );
      failure = navigateResult._tag === "Failure" ? navigateResult : null;
    }

    if (failure !== null) {
      await deleteThread({
        environmentId: sourceProject.environmentId,
        input: { threadId },
      });
      if (!isAtomCommandInterrupted(failure)) {
        const error = squashAtomCommandFailure(failure);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not start merge agent",
            description:
              error instanceof Error ? error.message : "The repair task could not be created.",
          }),
        );
      }
      setPhase("idle");
    }
  }, [
    createThread,
    deleteThread,
    navigate,
    phase,
    result,
    sourceProject,
    startThreadTurn,
    updaterModelSelection,
  ]);

  const runAutomaticMerge = useCallback(async () => {
    if (!sourceProject || phase !== "idle") return;
    setPhase("merging");
    const mergeResult = await mergeUpdate({
      environmentId: sourceProject.environmentId,
      input: { cwd: sourceProject.workspaceRoot },
    });
    setPhase("idle");

    if (mergeResult._tag === "Success") {
      setResult(mergeResult.value);
      if (mergeResult.value.status === "merged") {
        toastManager.add({
          type: "success",
          title: "T3 Code Live source updated",
          description: `${mergeResult.value.detail ?? "The upstream merge completed."} Rebuild the app when you are ready to install it.`,
        });
      }
      return;
    }
    if (!isAtomCommandInterrupted(mergeResult)) {
      const error = squashAtomCommandFailure(mergeResult);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not merge upstream",
          description: error instanceof Error ? error.message : "The automatic merge failed.",
        }),
      );
    }
  }, [mergeUpdate, phase, sourceProject]);

  const rawView = getForkUpdatePillView(result, phase);
  const dismissed =
    phase === "idle" &&
    result?.upstreamSha !== null &&
    result?.upstreamSha !== undefined &&
    dismissedSha === result.upstreamSha;
  const view =
    dismissed && result ? getForkUpdatePillView({ ...result, status: "current" }, phase) : rawView;
  if (APP_BASE_NAME !== "T3 Code Live" || !sourceProject || !view) return null;

  const agentUnavailable = view.action === "agent" && updaterModelSelection === null;
  const disabled = view.busy || view.action === "none" || agentUnavailable;
  const handleAction = () => {
    if (view.action === "check") {
      void runCheck(true);
    } else if (view.action === "merge") {
      void runAutomaticMerge();
    } else if (view.action === "agent") {
      void launchRepairAgent();
    }
  };

  return (
    <div
      className={`group/fork-update relative flex h-7 w-full items-center overflow-hidden rounded-lg text-xs font-medium transition-colors ${TONE_STYLES[view.tone]}`}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={view.description}
              disabled={disabled}
              className="fork-update-main relative flex h-full flex-1 items-center gap-2 px-2 text-left disabled:cursor-default"
              onClick={handleAction}
            >
              {view.busy ? (
                <LoaderIcon className="size-3.5 animate-spin" />
              ) : view.action === "agent" ? (
                <BotIcon className="size-3.5" />
              ) : view.tone === "success" ? (
                <CircleCheckIcon className="size-3.5" />
              ) : view.action === "check" ? (
                <RefreshCwIcon className="size-3.5" />
              ) : (
                <DownloadIcon className="size-3.5" />
              )}
              <span>{agentUnavailable ? "GPT-5.6-Sol unavailable" : view.title}</span>
            </button>
          }
        />
        <TooltipPopup side="top">
          {agentUnavailable
            ? "Enable GPT-5.6-Sol with High reasoning before starting the merge agent."
            : view.description}
        </TooltipPopup>
      </Tooltip>
      {view.dismissible && result?.upstreamSha ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Dismiss fork update notice"
                className="mr-1 inline-flex size-5 items-center justify-center rounded-md opacity-60 transition-opacity hover:opacity-100"
                onClick={() => setDismissedSha(result.upstreamSha)}
              >
                <XIcon className="size-3.5" />
              </button>
            }
          />
          <TooltipPopup side="top">Dismiss until another upstream commit arrives</TooltipPopup>
        </Tooltip>
      ) : null}
    </div>
  );
}

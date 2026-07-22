import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { LoaderIcon, PowerIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { APP_BASE_NAME, APP_STAGE_LABEL } from "../../branding";
import { useProjects, useThreadShells } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { liveForkUpdateEnvironment } from "../../state/liveForkUpdate";
import { useAtomCommand } from "../../state/use-atom-command";
import { findLiveForkSourceProject } from "../settings/forkSourceUpdate.logic";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { countActiveTasksForRestart } from "./SidebarLiveRebuild.logic";
import { SidebarLiveRebuildConfirmation } from "./SidebarLiveRebuildConfirmation";

export function SidebarLiveRebuildButton() {
  const projects = useProjects();
  const threadShells = useThreadShells();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const rebuild = useAtomCommand(liveForkUpdateEnvironment.rebuild, { reportFailure: false });
  const rebuildStatus = useAtomCommand(liveForkUpdateEnvironment.rebuildStatus, {
    reportFailure: false,
  });
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [restartConfirmationOpen, setRestartConfirmationOpen] = useState(false);
  const activeTaskCount = useMemo(() => countActiveTasksForRestart(threadShells), [threadShells]);
  const sourceProject = useMemo(
    () => findLiveForkSourceProject(projects, primaryEnvironmentId),
    [primaryEnvironmentId, projects],
  );

  useEffect(() => {
    if (!started || !sourceProject) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void rebuildStatus({
        environmentId: sourceProject.environmentId,
        input: { cwd: sourceProject.workspaceRoot },
      }).then((result) => {
        if (cancelled || result._tag !== "Success") return;
        if (result.value.state === "failed") {
          window.clearInterval(timer);
          setStarted(false);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "T3 Code Live rebuild failed",
              description:
                result.value.detail ?? `Open ${result.value.logPath} for the rebuild details.`,
            }),
          );
        }
      });
    }, 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [rebuildStatus, sourceProject, started]);

  const startRebuild = useCallback(async () => {
    if (!sourceProject || starting || started) return;
    setStarting(true);
    const result = await rebuild({
      environmentId: sourceProject.environmentId,
      input: { cwd: sourceProject.workspaceRoot },
    });
    setStarting(false);

    if (result._tag === "Success") {
      setStarted(true);
      toastManager.add({
        type: "success",
        title: "Rebuilding T3 Code Live…",
        description:
          "This creates and signs a packaged Nightly build. Use the lightning control for instant local iteration.",
        timeout: 0,
      });
      return;
    }
    if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not start T3 Code Live rebuild",
          description:
            error instanceof Error ? error.message : "The rebuild command could not start.",
        }),
      );
    }
  }, [rebuild, sourceProject, started, starting]);

  const handleClick = useCallback(() => {
    if (activeTaskCount > 0) {
      setRestartConfirmationOpen(true);
      return;
    }
    void startRebuild();
  }, [activeTaskCount, startRebuild]);

  if (APP_BASE_NAME !== "T3 Code Live" || APP_STAGE_LABEL !== "Nightly" || !sourceProject) {
    return null;
  }

  const label = starting
    ? "Starting T3 Code Live rebuild"
    : started
      ? "T3 Code Live is rebuilding and will restart automatically"
      : "Rebuild and relaunch T3 Code Live";
  const busy = starting || started;

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={label}
              disabled={busy}
              className={
                busy
                  ? "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md bg-warning/14 px-2 text-warning disabled:cursor-default"
                  : "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
              }
              onClick={handleClick}
            >
              {busy ? (
                <LoaderIcon className="size-3.5 animate-spin" />
              ) : (
                <PowerIcon className="size-3.5" />
              )}
              {busy ? (
                <span className="text-xs font-medium">
                  {starting ? "Starting…" : "Rebuilding…"}
                </span>
              ) : null}
            </button>
          }
        />
      <TooltipPopup side="top">
        {busy ? label : "Install a signed local build (full package and code-sign)"}
      </TooltipPopup>
      </Tooltip>
      <SidebarLiveRebuildConfirmation
        activeTaskCount={activeTaskCount}
        open={restartConfirmationOpen}
        onCancel={() => setRestartConfirmationOpen(false)}
        onConfirm={() => {
          setRestartConfirmationOpen(false);
          void startRebuild();
        }}
      />
    </>
  );
}

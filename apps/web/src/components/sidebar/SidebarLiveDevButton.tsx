import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { LoaderIcon, ZapIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

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

export function SidebarLiveDevButton() {
  const projects = useProjects();
  const threadShells = useThreadShells();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const devStart = useAtomCommand(liveForkUpdateEnvironment.devStart, { reportFailure: false });
  const [starting, setStarting] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const activeTaskCount = useMemo(() => countActiveTasksForRestart(threadShells), [threadShells]);
  const sourceProject = useMemo(
    () => findLiveForkSourceProject(projects, primaryEnvironmentId),
    [primaryEnvironmentId, projects],
  );

  const startDev = useCallback(async () => {
    if (!sourceProject || starting) return;
    setStarting(true);
    const result = await devStart({
      environmentId: sourceProject.environmentId,
      input: { cwd: sourceProject.workspaceRoot },
    });
    if (result._tag === "Success") {
      toastManager.add({
        type: "success",
        title: "Opening hot-reload mode…",
        description:
          "The first startup compiles once. Renderer edits then appear instantly; desktop and server edits restart only their process.",
        timeout: 0,
      });
      return;
    }
    setStarting(false);
    if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not start hot-reload mode",
          description: error instanceof Error ? error.message : "The development runner did not start.",
        }),
      );
    }
  }, [devStart, sourceProject, starting]);

  const handleClick = useCallback(() => {
    if (activeTaskCount > 0) {
      setConfirmationOpen(true);
      return;
    }
    void startDev();
  }, [activeTaskCount, startDev]);

  if (APP_BASE_NAME !== "T3 Code Live" || APP_STAGE_LABEL !== "Nightly" || !sourceProject) {
    return null;
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Open T3 Code Live in hot-reload mode"
              disabled={starting}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default"
              onClick={handleClick}
            >
              {starting ? (
                <LoaderIcon className="size-3.5 animate-spin text-primary" />
              ) : (
                <ZapIcon className="size-3.5" />
              )}
            </button>
          }
        />
        <TooltipPopup side="top">Open hot-reload mode for fast local edits</TooltipPopup>
      </Tooltip>
      <SidebarLiveRebuildConfirmation
        activeTaskCount={activeTaskCount}
        open={confirmationOpen}
        title="Switch to hot reload while a task is running?"
        description="Switching modes restarts the app and interrupts active work. The app will reopen from this checkout with live updates enabled."
        confirmLabel="Switch anyway"
        onCancel={() => setConfirmationOpen(false)}
        onConfirm={() => {
          setConfirmationOpen(false);
          void startDev();
        }}
      />
    </>
  );
}

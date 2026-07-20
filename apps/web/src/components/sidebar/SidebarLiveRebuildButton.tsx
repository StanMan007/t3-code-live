import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { LoaderIcon, PowerIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { APP_BASE_NAME, APP_STAGE_LABEL } from "../../branding";
import { useProjects } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { liveForkUpdateEnvironment } from "../../state/liveForkUpdate";
import { useAtomCommand } from "../../state/use-atom-command";
import { findLiveForkSourceProject } from "../settings/forkSourceUpdate.logic";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function SidebarLiveRebuildButton() {
  const projects = useProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const rebuild = useAtomCommand(liveForkUpdateEnvironment.rebuild, { reportFailure: false });
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const sourceProject = useMemo(
    () => findLiveForkSourceProject(projects, primaryEnvironmentId),
    [primaryEnvironmentId, projects],
  );

  const handleClick = useCallback(async () => {
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
          "This usually takes a few minutes. The app will close and reopen itself when the signed Nightly package is ready.",
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
            onClick={() => void handleClick()}
          >
            {busy ? (
              <LoaderIcon className="size-3.5 animate-spin" />
            ) : (
              <PowerIcon className="size-3.5" />
            )}
            {busy ? (
              <span className="text-xs font-medium">{starting ? "Starting…" : "Rebuilding…"}</span>
            ) : null}
          </button>
        }
      />
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

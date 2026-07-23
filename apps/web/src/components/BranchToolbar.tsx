import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  ChevronDownIcon,
  CloudIcon,
  FolderGit2Icon,
  FolderGitIcon,
  FolderIcon,
  MonitorIcon,
  WorkflowIcon,
} from "lucide-react";
import { memo, useMemo } from "react";

import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import { useProject, useThread } from "../state/entities";
import { useIsMobile } from "../hooks/useMediaQuery";
import {
  type EnvMode,
  type EnvironmentOption,
  resolveCurrentWorkspaceLabel,
  resolveEnvModeLabel,
  resolveEffectiveEnvMode,
  resolveLockedWorkspaceLabel,
  shouldShowEnvironmentIndicator,
} from "./BranchToolbar.logic";
import { BranchToolbarBranchSelector } from "./BranchToolbarBranchSelector";
import { BranchToolbarEnvironmentSelector } from "./BranchToolbarEnvironmentSelector";
import { BranchToolbarEnvModeSelector } from "./BranchToolbarEnvModeSelector";
import { Button } from "./ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "./ui/menu";
import { Separator } from "./ui/separator";

interface BranchToolbarProps {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  draftId?: DraftId;
  onEnvModeChange: (mode: EnvMode) => void;
  effectiveEnvModeOverride?: EnvMode;
  activeThreadBranchOverride?: string | null;
  onActiveThreadBranchOverrideChange?: (branch: string | null) => void;
  startFromOrigin: boolean;
  onStartFromOriginChange: (startFromOrigin: boolean) => void;
  envLocked: boolean;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest?: () => void;
  availableEnvironments?: readonly EnvironmentOption[];
  onEnvironmentChange?: (environmentId: EnvironmentId) => void;
  workflowHistoryCount?: number;
  onOpenWorkflows?: () => void;
  embedded?: boolean;
}

interface MobileRunContextSelectorProps {
  envLocked: boolean;
  envModeLocked: boolean;
  environmentId: EnvironmentId;
  availableEnvironments: readonly EnvironmentOption[] | undefined;
  showEnvironmentPicker: boolean;
  showEnvironmentIndicator: boolean;
  onEnvironmentChange: ((environmentId: EnvironmentId) => void) | undefined;
  effectiveEnvMode: EnvMode;
  activeWorktreePath: string | null;
  onEnvModeChange: (mode: EnvMode) => void;
}

const MobileRunContextSelector = memo(function MobileRunContextSelector({
  envLocked,
  envModeLocked,
  environmentId,
  availableEnvironments,
  showEnvironmentPicker,
  showEnvironmentIndicator,
  onEnvironmentChange,
  effectiveEnvMode,
  activeWorktreePath,
  onEnvModeChange,
}: MobileRunContextSelectorProps) {
  const activeEnvironment = useMemo(
    () => availableEnvironments?.find((env) => env.environmentId === environmentId) ?? null,
    [availableEnvironments, environmentId],
  );
  const WorkspaceIcon =
    effectiveEnvMode === "worktree"
      ? FolderGit2Icon
      : activeWorktreePath
        ? FolderGitIcon
        : FolderIcon;
  const workspaceLabel = envModeLocked
    ? resolveLockedWorkspaceLabel(activeWorktreePath)
    : effectiveEnvMode === "worktree"
      ? resolveEnvModeLabel("worktree")
      : resolveCurrentWorkspaceLabel(activeWorktreePath);
  const isLocked = envLocked || envModeLocked;
  const EnvironmentIcon = activeEnvironment?.isPrimary ? MonitorIcon : CloudIcon;
  const icon = showEnvironmentIndicator ? (
    // Button's base styles apply `-mx-0.5` to descendant SVGs, which eats 4px
    // out of whatever gap we set. mx-0! cancels that so gap-0.5 reads as 2px.
    <span className="inline-flex shrink-0 items-center gap-0.5">
      <EnvironmentIcon className="size-3 shrink-0 mx-0!" />
      <WorkspaceIcon className="size-3 shrink-0 mx-0!" />
    </span>
  ) : (
    <WorkspaceIcon className="size-3 shrink-0" />
  );
  const triggerContent = (
    <>
      {icon}
      <span className="min-w-0 truncate">
        {showEnvironmentIndicator ? (activeEnvironment?.label ?? "Run on") : workspaceLabel}
      </span>
    </>
  );

  if (isLocked) {
    return (
      <span className="inline-flex min-w-0 max-w-[48%] flex-1 items-center justify-start gap-1 rounded-md border border-transparent px-[calc(--spacing(2)-1px)] text-sm font-medium text-muted-foreground/70 md:hidden">
        {triggerContent}
      </span>
    );
  }

  return (
    <Menu>
      <MenuTrigger
        render={<Button variant="ghost" size="xs" />}
        className="min-w-0 max-w-[48%] flex-1 justify-start text-muted-foreground/70 hover:text-foreground/80 md:hidden"
      >
        {triggerContent}
        <ChevronDownIcon className="size-3 shrink-0 opacity-50" />
      </MenuTrigger>
      <MenuPopup align="start" side="top" className="w-64">
        {showEnvironmentPicker && availableEnvironments && onEnvironmentChange ? (
          <>
            <MenuGroup>
              <MenuGroupLabel>Run on</MenuGroupLabel>
              <MenuRadioGroup
                value={environmentId}
                onValueChange={(value) => onEnvironmentChange(value as EnvironmentId)}
              >
                {availableEnvironments.map((env) => {
                  const Icon = env.isPrimary ? MonitorIcon : CloudIcon;
                  return (
                    <MenuRadioItem
                      key={env.environmentId}
                      disabled={envLocked}
                      value={env.environmentId}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Icon className="size-3" />
                        <span className="min-w-0 truncate">{env.label}</span>
                      </span>
                    </MenuRadioItem>
                  );
                })}
              </MenuRadioGroup>
            </MenuGroup>
            <MenuSeparator />
          </>
        ) : null}
        <MenuGroup>
          <MenuGroupLabel>Workspace</MenuGroupLabel>
          <MenuRadioGroup
            value={effectiveEnvMode}
            onValueChange={(value) => onEnvModeChange(value as EnvMode)}
          >
            <MenuRadioItem disabled={envModeLocked} value="local">
              <span className="flex min-w-0 items-center gap-1.5">
                {activeWorktreePath ? (
                  <FolderGitIcon className="size-3" />
                ) : (
                  <FolderIcon className="size-3" />
                )}
                <span className="min-w-0 truncate">
                  {resolveCurrentWorkspaceLabel(activeWorktreePath)}
                </span>
              </span>
            </MenuRadioItem>
            <MenuRadioItem disabled={envModeLocked} value="worktree">
              <span className="flex min-w-0 items-center gap-1.5">
                <FolderGit2Icon className="size-3" />
                <span className="min-w-0 truncate">{resolveEnvModeLabel("worktree")}</span>
              </span>
            </MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
});

export const BranchToolbar = memo(function BranchToolbar({
  environmentId,
  threadId,
  draftId,
  onEnvModeChange,
  effectiveEnvModeOverride,
  activeThreadBranchOverride,
  onActiveThreadBranchOverrideChange,
  startFromOrigin,
  onStartFromOriginChange,
  envLocked,
  onCheckoutPullRequestRequest,
  onComposerFocusRequest,
  availableEnvironments,
  onEnvironmentChange,
  workflowHistoryCount = 0,
  onOpenWorkflows,
  embedded = false,
}: BranchToolbarProps) {
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const serverThread = useThread(threadRef);
  const draftThread = useComposerDraftStore((store) =>
    draftId ? store.getDraftSession(draftId) : store.getDraftThreadByRef(threadRef),
  );
  const activeProjectRef = serverThread
    ? scopeProjectRef(serverThread.environmentId, serverThread.projectId)
    : draftThread
      ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
      : null;
  const activeProject = useProject(activeProjectRef);
  const hasActiveThread = serverThread !== null || draftThread !== null;
  const activeWorktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const effectiveEnvMode =
    effectiveEnvModeOverride ??
    resolveEffectiveEnvMode({
      activeWorktreePath,
      hasServerThread: serverThread !== null,
      draftThreadEnvMode: draftThread?.envMode,
    });
  const envModeLocked = envLocked || (serverThread !== null && activeWorktreePath !== null);

  const showEnvironmentPicker = Boolean(
    availableEnvironments && availableEnvironments.length > 1 && onEnvironmentChange,
  );
  const activeEnvironmentOption =
    availableEnvironments?.find((env) => env.environmentId === environmentId) ?? null;
  const showEnvironmentIndicator = shouldShowEnvironmentIndicator({
    activeEnvironment: activeEnvironmentOption,
    canPickEnvironment: showEnvironmentPicker,
  });
  const isMobile = useIsMobile();

  if (!hasActiveThread || !activeProject) return null;

  if (embedded) {
    return (
      <div className="grid gap-1" data-chat-composer-run-context-controls="true">
        <div className="px-2 pt-1 font-medium text-muted-foreground text-xs">Run context</div>
        {showEnvironmentIndicator && availableEnvironments ? (
          <div className="flex min-w-0 items-center justify-between gap-3 rounded-md px-2 py-1">
            <span className="text-muted-foreground text-xs">Environment</span>
            <BranchToolbarEnvironmentSelector
              envLocked={envLocked}
              environmentId={environmentId}
              availableEnvironments={availableEnvironments}
              {...(showEnvironmentPicker && onEnvironmentChange ? { onEnvironmentChange } : {})}
            />
          </div>
        ) : null}
        <div className="flex min-w-0 items-center justify-between gap-3 rounded-md px-2 py-1">
          <span className="text-muted-foreground text-xs">Workspace</span>
          <BranchToolbarEnvModeSelector
            envLocked={envModeLocked}
            effectiveEnvMode={effectiveEnvMode}
            activeWorktreePath={activeWorktreePath}
            onEnvModeChange={onEnvModeChange}
          />
        </div>
        <div className="flex min-w-0 items-center justify-between gap-3 rounded-md px-2 py-1">
          <span className="text-muted-foreground text-xs">Branch</span>
          <BranchToolbarBranchSelector
            className="min-w-0 justify-end"
            environmentId={environmentId}
            threadId={threadId}
            {...(draftId ? { draftId } : {})}
            envLocked={envLocked}
            {...(effectiveEnvModeOverride ? { effectiveEnvModeOverride } : {})}
            {...(activeThreadBranchOverride !== undefined ? { activeThreadBranchOverride } : {})}
            {...(onActiveThreadBranchOverrideChange ? { onActiveThreadBranchOverrideChange } : {})}
            startFromOrigin={startFromOrigin}
            onStartFromOriginChange={onStartFromOriginChange}
            {...(onCheckoutPullRequestRequest ? { onCheckoutPullRequestRequest } : {})}
            {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
          />
        </div>
        {workflowHistoryCount > 0 && onOpenWorkflows ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-workflow-history-trigger="true"
            className="w-full justify-between px-2 font-normal"
            aria-label={`Open ${workflowHistoryCount} saved ${
              workflowHistoryCount === 1 ? "workflow" : "workflows"
            }`}
            onClick={onOpenWorkflows}
          >
            <span className="inline-flex items-center gap-2">
              <WorkflowIcon className="size-3.5 text-muted-foreground" />
              Workflows
            </span>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground/60">
              {workflowHistoryCount}
            </span>
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="chat-composer-context-strip -mt-4 mx-auto flex w-[calc(100%-1.5rem)] max-w-[calc(48rem-1.5rem)] items-center gap-2 pt-5 pb-1 ps-1">
      {isMobile ? (
        <MobileRunContextSelector
          envLocked={envLocked}
          envModeLocked={envModeLocked}
          environmentId={environmentId}
          availableEnvironments={availableEnvironments}
          showEnvironmentPicker={showEnvironmentPicker}
          showEnvironmentIndicator={showEnvironmentIndicator}
          onEnvironmentChange={onEnvironmentChange}
          effectiveEnvMode={effectiveEnvMode}
          activeWorktreePath={activeWorktreePath}
          onEnvModeChange={onEnvModeChange}
        />
      ) : (
        <div className="flex min-w-0 shrink-0 items-center gap-1">
          {showEnvironmentIndicator && availableEnvironments && (
            <>
              <BranchToolbarEnvironmentSelector
                envLocked={envLocked}
                environmentId={environmentId}
                availableEnvironments={availableEnvironments}
                {...(showEnvironmentPicker && onEnvironmentChange ? { onEnvironmentChange } : {})}
              />
              <Separator orientation="vertical" className="mx-0.5 h-3.5!" />
            </>
          )}
          <BranchToolbarEnvModeSelector
            envLocked={envModeLocked}
            effectiveEnvMode={effectiveEnvMode}
            activeWorktreePath={activeWorktreePath}
            onEnvModeChange={onEnvModeChange}
          />
        </div>
      )}

      {workflowHistoryCount > 0 && onOpenWorkflows ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          data-workflow-history-trigger="true"
          className="shrink-0 gap-1.5 px-2 text-muted-foreground/55 hover:text-foreground/80"
          aria-label={`Open ${workflowHistoryCount} saved ${
            workflowHistoryCount === 1 ? "workflow" : "workflows"
          }`}
          onClick={onOpenWorkflows}
        >
          <WorkflowIcon className="size-3" />
          <span className="hidden sm:inline">Workflows</span>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground/40">
            {workflowHistoryCount}
          </span>
        </Button>
      ) : null}

      <BranchToolbarBranchSelector
        className="min-w-0 flex-1 justify-end md:ml-auto md:flex-none"
        environmentId={environmentId}
        threadId={threadId}
        {...(draftId ? { draftId } : {})}
        envLocked={envLocked}
        {...(effectiveEnvModeOverride ? { effectiveEnvModeOverride } : {})}
        {...(activeThreadBranchOverride !== undefined ? { activeThreadBranchOverride } : {})}
        {...(onActiveThreadBranchOverrideChange ? { onActiveThreadBranchOverrideChange } : {})}
        startFromOrigin={startFromOrigin}
        onStartFromOriginChange={onStartFromOriginChange}
        {...(onCheckoutPullRequestRequest ? { onCheckoutPullRequestRequest } : {})}
        {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
      />
    </div>
  );
});

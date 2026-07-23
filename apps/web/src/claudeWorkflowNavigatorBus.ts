const CLAUDE_WORKFLOW_NAVIGATOR_OPEN_EVENT = "t3:claude-workflows:open";

export interface ClaudeWorkflowNavigatorTarget {
  workflowRunId?: string;
  agentId?: string;
}

export function requestClaudeWorkflowNavigatorOpen(
  target: ClaudeWorkflowNavigatorTarget = {},
): void {
  window.dispatchEvent(
    new CustomEvent<ClaudeWorkflowNavigatorTarget>(CLAUDE_WORKFLOW_NAVIGATOR_OPEN_EVENT, {
      detail: target,
    }),
  );
}

export function onClaudeWorkflowNavigatorOpen(
  listener: (target: ClaudeWorkflowNavigatorTarget) => void,
): () => void {
  const handleOpen = (event: Event) => {
    listener((event as CustomEvent<ClaudeWorkflowNavigatorTarget>).detail ?? {});
  };
  window.addEventListener(CLAUDE_WORKFLOW_NAVIGATOR_OPEN_EVENT, handleOpen);
  return () => window.removeEventListener(CLAUDE_WORKFLOW_NAVIGATOR_OPEN_EVENT, handleOpen);
}

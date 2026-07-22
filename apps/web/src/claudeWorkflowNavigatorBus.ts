const CLAUDE_WORKFLOW_NAVIGATOR_OPEN_EVENT = "t3:claude-workflows:open";

export function requestClaudeWorkflowNavigatorOpen(): void {
  window.dispatchEvent(new Event(CLAUDE_WORKFLOW_NAVIGATOR_OPEN_EVENT));
}

export function onClaudeWorkflowNavigatorOpen(listener: () => void): () => void {
  window.addEventListener(CLAUDE_WORKFLOW_NAVIGATOR_OPEN_EVENT, listener);
  return () => window.removeEventListener(CLAUDE_WORKFLOW_NAVIGATOR_OPEN_EVENT, listener);
}

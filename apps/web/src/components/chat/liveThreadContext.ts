import type { ChatMessage } from "../../types";

export type LiveThreadContextScope = "latest_request" | "recent" | "full";

export interface LiveThreadContextRequest {
  readonly scope: LiveThreadContextScope;
  readonly query?: string;
  readonly cursor?: number;
}

export interface LiveThreadContextResult {
  readonly scope: LiveThreadContextScope;
  readonly query: string | null;
  readonly cursor: number;
  readonly nextCursor: number | null;
  readonly totalCharacters: number;
  readonly matchedMessages: number;
  readonly context: string;
}

const CONTEXT_PAGE_CHARACTERS = 12_000;
const INITIAL_MESSAGE_CHARACTERS = 18_000;

export function hasExplicitLiveThreadDispatchIntent(transcript: string): boolean {
  return /\b(?:send|dispatch|submit|hand[ -]?off)(?:\s+(?:it|that|this|the\s+(?:request|task|instruction)))?\b|\b(?:go\s+ahead|start\s+(?:the\s+)?(?:work|task))\b/iu.test(
    transcript,
  );
}

function relevantMessages(messages: ReadonlyArray<ChatMessage>): ChatMessage[] {
  return messages.filter(
    (message) =>
      (message.role === "user" || message.role === "assistant") &&
      (message.text.trim().length > 0 || (message.attachments?.length ?? 0) > 0),
  );
}

function attachmentSummary(message: ChatMessage): string {
  const attachments = message.attachments ?? [];
  if (attachments.length === 0) return "";
  return `\nAttachments: ${attachments
    .map(
      (attachment) => `${attachment.name} (${attachment.mimeType}, ${attachment.sizeBytes} bytes)`,
    )
    .join(", ")}`;
}

function formatMessage(message: ChatMessage): string {
  const role = message.role === "user" ? "User" : "Codex";
  const body = message.text.trim() || "[No text]";
  return `[${message.id}] ${role} · ${message.createdAt}\n${body}${attachmentSummary(message)}`;
}

function boundedInitialMessage(message: ChatMessage): string {
  const formatted = formatMessage(message);
  if (formatted.length <= INITIAL_MESSAGE_CHARACTERS) return formatted;
  const half = Math.floor(INITIAL_MESSAGE_CHARACTERS / 2);
  return `${formatted.slice(0, half)}\n\n[Middle omitted from initial context; call read_task_context with scope latest_request to read every page.]\n\n${formatted.slice(-half)}`;
}

export function buildLiveThreadPrompt(messages: ReadonlyArray<ChatMessage>): string {
  const relevant = relevantMessages(messages);
  const latestRequest = relevant.findLast((message) => message.role === "user");
  const latestResult = relevant.findLast((message) => message.role === "assistant");

  return [
    "Discuss the current T3 Code task naturally and help the user reason through it.",
    "The complete task text is available through read_task_context. Use that tool before saying a detail is unavailable or asking the user to repeat something.",
    "Attachment metadata is included in task context. Do not claim to have visually inspected an image unless its contents were also described in text.",
    latestRequest
      ? `Current user request:\n${boundedInitialMessage(latestRequest)}`
      : "The task has no user request yet.",
    latestResult ? `Latest Codex result:\n${boundedInitialMessage(latestResult)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function selectMessages(
  messages: ReadonlyArray<ChatMessage>,
  scope: LiveThreadContextScope,
): ChatMessage[] {
  const relevant = relevantMessages(messages);
  if (scope === "latest_request") {
    const latest = relevant.findLast((message) => message.role === "user");
    return latest ? [latest] : [];
  }
  if (scope === "recent") return relevant.slice(-12);
  return relevant;
}

export function readLiveThreadContext(
  messages: ReadonlyArray<ChatMessage>,
  request: LiveThreadContextRequest,
): LiveThreadContextResult {
  const query = request.query?.trim() ?? "";
  const normalizedQuery = query.toLocaleLowerCase();
  const selected = selectMessages(messages, request.scope).filter((message) => {
    if (!normalizedQuery) return true;
    return (
      message.text.toLocaleLowerCase().includes(normalizedQuery) ||
      (message.attachments ?? []).some((attachment) =>
        attachment.name.toLocaleLowerCase().includes(normalizedQuery),
      )
    );
  });
  const serialized =
    selected.length > 0
      ? selected.map(formatMessage).join("\n\n---\n\n")
      : query
        ? `No task message exactly matched ${JSON.stringify(query)}. Retry with a broader query or scope full.`
        : "No task messages are available for this scope.";
  const requestedCursor = Number.isFinite(request.cursor) ? Math.floor(request.cursor ?? 0) : 0;
  const cursor = Math.max(0, Math.min(requestedCursor, serialized.length));
  const end = Math.min(cursor + CONTEXT_PAGE_CHARACTERS, serialized.length);

  return {
    scope: request.scope,
    query: query || null,
    cursor,
    nextCursor: end < serialized.length ? end : null,
    totalCharacters: serialized.length,
    matchedMessages: selected.length,
    context: serialized.slice(cursor, end),
  };
}

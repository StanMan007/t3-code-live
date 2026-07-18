export type LiveThreadEvent =
  | {
      readonly type: "transcript.delta";
      readonly role: "user" | "assistant";
      readonly text: string;
    }
  | { readonly type: "transcript.done"; readonly role: "user" | "assistant"; readonly text: string }
  | { readonly type: "handoff"; readonly text: string; readonly callId?: string }
  | {
      readonly type: "context.request";
      readonly callId: string;
      readonly scope: "latest_request" | "recent" | "full";
      readonly query?: string;
      readonly cursor?: number;
    }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "ignored" };

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : undefined;
}

function parseArguments(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string") return record(value);
  try {
    return record(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function handoff(
  candidate: Record<string, unknown>,
): { readonly text: string; readonly callId?: string } | undefined {
  if (candidate.type === "handoff_request") {
    const value =
      text(candidate.input_transcript) ??
      text(candidate.prompt) ??
      text(candidate.text) ??
      text(candidate.instructions);
    return value ? { text: value } : undefined;
  }
  if (candidate.type === "function_call" && candidate.name === "background_agent") {
    const args = parseArguments(candidate.arguments);
    const value = args
      ? (text(args.input_transcript) ??
        text(args.prompt) ??
        text(args.text) ??
        text(args.instructions))
      : undefined;
    const callId = text(candidate.call_id);
    return value ? { text: value, ...(callId ? { callId } : {}) } : undefined;
  }
  if (candidate.type === "function_call" && candidate.name === "send_to_codex") {
    const args = parseArguments(candidate.arguments);
    const value = args ? text(args.instruction) : undefined;
    const callId = text(candidate.call_id);
    return value ? { text: value, ...(callId ? { callId } : {}) } : undefined;
  }
  return undefined;
}

function contextRequest(candidate: Record<string, unknown>): LiveThreadEvent | undefined {
  if (candidate.type !== "function_call" || candidate.name !== "read_task_context") {
    return undefined;
  }
  const args = parseArguments(candidate.arguments);
  const callId = text(candidate.call_id);
  const scope = text(args?.scope);
  if (!callId || (scope !== "latest_request" && scope !== "recent" && scope !== "full")) {
    return undefined;
  }
  const query = text(args?.query);
  const rawCursor = args?.cursor;
  const cursor =
    typeof rawCursor === "number" && Number.isFinite(rawCursor) ? rawCursor : undefined;
  return {
    type: "context.request",
    callId,
    scope,
    ...(query ? { query } : {}),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

export function parseLiveThreadEvent(input: unknown): LiveThreadEvent {
  const event = record(input);
  if (!event) return { type: "ignored" };
  const eventType = text(event.type) ?? "";
  const item = record(event.item);
  const nestedOutputs = record(event.response)?.output;
  const candidates = [item, event];
  if (Array.isArray(nestedOutputs)) candidates.push(...nestedOutputs.map(record));
  const requestedContext = candidates.find((candidate) => candidate && contextRequest(candidate));
  if (requestedContext) return contextRequest(requestedContext) ?? { type: "ignored" };
  const responseHandoff = candidates.find((candidate) => candidate && handoff(candidate));
  const preparedHandoff =
    (item ? handoff(item) : undefined) ??
    handoff(event) ??
    (responseHandoff ? handoff(responseHandoff) : undefined);
  if (preparedHandoff) return { type: "handoff", ...preparedHandoff };

  if (eventType === "conversation.item.input_audio_transcription.delta") {
    const delta = text(event.delta);
    return delta ? { type: "transcript.delta", role: "user", text: delta } : { type: "ignored" };
  }
  if (eventType === "conversation.item.input_audio_transcription.completed") {
    const transcript = text(event.transcript);
    return transcript
      ? { type: "transcript.done", role: "user", text: transcript }
      : { type: "ignored" };
  }
  if (eventType === "response.output_audio_transcript.delta") {
    const delta = text(event.delta);
    return delta
      ? { type: "transcript.delta", role: "assistant", text: delta }
      : { type: "ignored" };
  }
  if (eventType === "response.output_audio_transcript.done") {
    const transcript = text(event.transcript);
    return transcript
      ? { type: "transcript.done", role: "assistant", text: transcript }
      : { type: "ignored" };
  }
  if (eventType === "error") {
    const nestedError = record(event.error);
    return {
      type: "error",
      message: text(nestedError?.message) ?? text(event.message) ?? "The voice session failed.",
    };
  }
  return { type: "ignored" };
}

export function parseLiveThreadDataMessage(data: unknown): LiveThreadEvent {
  if (typeof data !== "string") return { type: "ignored" };
  try {
    return parseLiveThreadEvent(JSON.parse(data));
  } catch {
    return { type: "ignored" };
  }
}

import { describe, expect, it } from "vite-plus/test";

import { parseLiveThreadDataMessage, parseLiveThreadEvent } from "./liveThreadEvents";

describe("liveThreadEvents", () => {
  it("extracts a client-managed handoff request", () => {
    expect(
      parseLiveThreadEvent({
        type: "response.output_item.done",
        item: {
          type: "function_call",
          name: "background_agent",
          arguments: JSON.stringify({ input_transcript: "Implement the voice bridge." }),
        },
      }),
    ).toEqual({ type: "handoff", text: "Implement the voice bridge." });
  });

  it("extracts a confirmed dispatch draft from a direct Realtime response", () => {
    expect(
      parseLiveThreadEvent({
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "send_to_codex",
              call_id: "call-1",
              arguments: JSON.stringify({
                instruction: "Implement the voice bridge and verify the packaged app.",
                summary: "The implementation request is ready.",
              }),
            },
          ],
        },
      }),
    ).toEqual({
      type: "handoff",
      text: "Implement the voice bridge and verify the packaged app.",
      callId: "call-1",
    });
  });

  it("extracts a paged task-context request", () => {
    expect(
      parseLiveThreadEvent({
        type: "response.output_item.done",
        item: {
          type: "function_call",
          name: "read_task_context",
          call_id: "context-1",
          arguments: JSON.stringify({ scope: "full", query: "acceptance", cursor: 12000 }),
        },
      }),
    ).toEqual({
      type: "context.request",
      callId: "context-1",
      scope: "full",
      query: "acceptance",
      cursor: 12000,
    });
  });

  it("extracts user transcript deltas", () => {
    expect(
      parseLiveThreadEvent({
        type: "conversation.item.input_audio_transcription.delta",
        delta: "hello",
      }),
    ).toEqual({ type: "transcript.delta", role: "user", text: "hello" });
  });

  it("ignores malformed data channel messages", () => {
    expect(parseLiveThreadDataMessage("not-json")).toEqual({ type: "ignored" });
  });
});

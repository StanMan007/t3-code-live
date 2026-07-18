import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildRealtimeSession } from "./realtimeBridge.ts";

describe("buildRealtimeSession", () => {
  it("uses the maintained Live Thread model and explicit dispatch tool", () => {
    const session = buildRealtimeSession({
      threadId: ThreadId.make("thread-1"),
      sdp: "offer-sdp",
      prompt: "Current task context: add a native voice control.",
    });

    expect(session.model).toBe("gpt-realtime-2.1");
    expect(session.audio.output.voice).toBe("marin");
    expect(session.instructions).toContain("Current task context");
    expect(session.tools[0]?.name).toBe("send_to_codex");
    expect(session.tools[0]?.parameters.required).toEqual(["instruction", "summary"]);
  });
});

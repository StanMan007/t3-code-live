import { MessageId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ChatMessage } from "../../types";
import {
  buildLiveThreadPrompt,
  hasExplicitLiveThreadDispatchIntent,
  readLiveThreadContext,
} from "./liveThreadContext";

function message(id: string, role: "user" | "assistant", text: string): ChatMessage {
  return {
    id: MessageId.make(id),
    role,
    text,
    turnId: null,
    streaming: false,
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
  };
}

describe("liveThreadContext", () => {
  it("puts the complete latest request and latest result in the initial prompt", () => {
    const prompt = buildLiveThreadPrompt([
      message("m1", "user", "Older request"),
      message("m2", "assistant", "Older result"),
      message("m3", "user", "Latest request with the exact acceptance criteria"),
      message("m4", "assistant", "Latest verified result"),
    ]);

    expect(prompt).toContain("Latest request with the exact acceptance criteria");
    expect(prompt).toContain("Latest verified result");
    expect(prompt).toContain("read_task_context");
    expect(prompt).toContain("Default to one short sentence");
    expect(prompt).toContain("Never use a preamble");
    expect(prompt).toContain("Ask at most one question");
  });

  it("pages through full task history without dropping text", () => {
    const longText = "context ".repeat(2_000);
    const first = readLiveThreadContext([message("m1", "user", longText)], {
      scope: "full",
    });
    expect(first.nextCursor).not.toBeNull();

    const second = readLiveThreadContext([message("m1", "user", longText)], {
      scope: "full",
      cursor: first.nextCursor ?? 0,
    });
    expect(first.context + second.context).toContain(longText.trim());
  });

  it("can search task text and attachment names", () => {
    const attached: ChatMessage = {
      ...message("m1", "user", "Please inspect the interface"),
      attachments: [
        {
          type: "image",
          id: "image-1",
          name: "live-thread-ui.png",
          mimeType: "image/png",
          sizeBytes: 42,
        },
      ],
    };
    const result = readLiveThreadContext([attached], {
      scope: "full",
      query: "live-thread-ui",
    });

    expect(result.matchedMessages).toBe(1);
    expect(result.context).toContain("live-thread-ui.png");
  });

  it("requires explicit spoken dispatch intent", () => {
    expect(hasExplicitLiveThreadDispatchIntent("Please send that to Codex now.")).toBe(true);
    expect(hasExplicitLiveThreadDispatchIntent("Go ahead and start the work.")).toBe(true);
    expect(hasExplicitLiveThreadDispatchIntent("Maybe we could update the task later.")).toBe(
      false,
    );
  });
});

import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { getCompactComposerModelName } from "./providerIconUtils";

describe("getCompactComposerModelName", () => {
  it("uses the provider icon to keep Codex model labels compact", () => {
    expect(
      getCompactComposerModelName(
        { slug: "gpt-5.6-sol", name: "GPT-5.6-Sol" },
        ProviderDriverKind.make("codex"),
      ),
    ).toBe("5.6 Sol");
  });

  it("uses the provider icon to keep Claude model labels compact", () => {
    expect(
      getCompactComposerModelName(
        { slug: "claude-fable-5", name: "Claude Fable 5" },
        ProviderDriverKind.make("claudeAgent"),
      ),
    ).toBe("Fable 5");
  });

  it("preserves other provider model names", () => {
    expect(
      getCompactComposerModelName(
        { slug: "grok-code-fast", name: "Grok Code Fast" },
        ProviderDriverKind.make("grok"),
      ),
    ).toBe("Grok Code Fast");
  });
});

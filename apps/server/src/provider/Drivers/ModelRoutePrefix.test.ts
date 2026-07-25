import { describe, expect, it } from "@effect/vitest";

import { applyModelRoutePrefix } from "./ModelRoutePrefix.ts";

describe("applyModelRoutePrefix", () => {
  it("prepends a normalized account prefix", () => {
    expect(applyModelRoutePrefix(" dossierx/ ", "claude-opus-5")).toBe("dossierx/claude-opus-5");
  });

  it("does not duplicate an existing prefix", () => {
    expect(applyModelRoutePrefix("personal", "personal/gpt-5.6-sol")).toBe("personal/gpt-5.6-sol");
  });

  it("preserves the selected model when no prefix is configured", () => {
    expect(applyModelRoutePrefix("", "gpt-5.6-sol")).toBe("gpt-5.6-sol");
  });
});

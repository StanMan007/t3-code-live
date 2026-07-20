import { assert, describe, it } from "@effect/vitest";

import { liveForkUpdateCommandKey } from "./liveForkUpdate.ts";

describe("live fork update command scheduling", () => {
  const target = {
    environmentId: "local",
    input: { cwd: "/Users/test/t3code" },
  };

  it("keeps checks, merges, and rebuilds in separate single-flight lanes", () => {
    const checkKey = liveForkUpdateCommandKey("check", target);
    const mergeKey = liveForkUpdateCommandKey("merge", target);
    const rebuildKey = liveForkUpdateCommandKey("rebuild", target);

    assert.equal(new Set([checkKey, mergeKey, rebuildKey]).size, 3);
  });

  it("deduplicates repeated calls to the same command and target", () => {
    assert.equal(
      liveForkUpdateCommandKey("rebuild", target),
      liveForkUpdateCommandKey("rebuild", target),
    );
  });
});

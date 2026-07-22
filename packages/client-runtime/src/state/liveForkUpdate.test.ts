import { assert, describe, it } from "@effect/vitest";

import { liveForkUpdateCommandKey } from "./liveForkUpdate.ts";

describe("live fork update command scheduling", () => {
  const target = {
    environmentId: "local",
    input: { cwd: "/Users/test/t3code" },
  };

  it("keeps update, development, and rebuild commands in separate single-flight lanes", () => {
    const checkKey = liveForkUpdateCommandKey("check", target);
    const mergeKey = liveForkUpdateCommandKey("merge", target);
    const rebuildKey = liveForkUpdateCommandKey("rebuild", target);
    const devStartKey = liveForkUpdateCommandKey("devStart", target);
    const rebuildStatusKey = liveForkUpdateCommandKey("rebuildStatus", target);

    assert.equal(new Set([checkKey, mergeKey, devStartKey, rebuildKey, rebuildStatusKey]).size, 5);
  });

  it("deduplicates repeated calls to the same command and target", () => {
    assert.equal(
      liveForkUpdateCommandKey("rebuild", target),
      liveForkUpdateCommandKey("rebuild", target),
    );
  });
});

import { assert } from "@effect/vitest";
import type { ProviderReplayTranscript } from "@t3tools/contracts";

import type { OrchestratorV2ScenarioResult } from "../../OrchestratorScenario.ts";
import {
  assertBaseProjection,
  assertSemanticProjectionIntegrity,
  assertUserMessagesInclude,
  CLAUDE_PROVIDER_WAKEUP_FOLLOW_UP,
  CLAUDE_PROVIDER_WAKEUP_PROMPT,
  projectionFor,
} from "../shared.ts";

export function assertClaudeProviderWakeupOutput(
  result: OrchestratorV2ScenarioResult,
  transcript: ProviderReplayTranscript,
) {
  assertBaseProjection({
    result,
    transcript,
    runCount: 3,
    runStatuses: ["completed", "completed", "completed"],
  });

  const projection = projectionFor(result, transcript.scenario);
  assertSemanticProjectionIntegrity(projection);
  assertUserMessagesInclude(projection, [
    CLAUDE_PROVIDER_WAKEUP_PROMPT,
    CLAUDE_PROVIDER_WAKEUP_FOLLOW_UP,
  ]);

  // Run 2 is the provider-initiated wakeup: minted by the wakeup dispatcher
  // reacting to the adapter's `turn.wakeup` announcement, never by a user
  // command. Its synthetic message records why the provider resumed.
  const wakeupRun = projection.runs.find((run) => run.ordinal === 2);
  assert.isDefined(wakeupRun);
  assert.equal(wakeupRun?.status, "completed");
  const wakeupMessage = projection.messages.find(
    (message) => message.id === wakeupRun?.userMessageId,
  );
  assert.isDefined(wakeupMessage);
  assert.equal(wakeupMessage?.createdBy, "system");
  assert.equal(wakeupMessage?.creationSource, "provider");
  assert.include(
    wakeupMessage?.text ?? "",
    "Resumed by the provider: a background task finished",
  );
  assert.include(
    wakeupMessage?.text ?? "",
    'Background command "Poll for new bot reviews on the PR" completed',
  );

  const wakeupUserItem = projection.turnItems.find(
    (item) => item.runId === wakeupRun?.id && item.type === "user_message",
  );
  assert.isDefined(wakeupUserItem);
  assert.equal(
    wakeupUserItem?.type === "user_message" ? wakeupUserItem.inputIntent : undefined,
    "provider_wakeup",
  );

  // The wakeup turn's buffered activity must be replayed into the attached
  // run: the review-check command and the closing assistant message.
  const wakeupItems = projection.turnItems.filter(
    (item) => item.runId === wakeupRun?.id && item.type !== "checkpoint",
  );
  assert.deepEqual(
    wakeupItems.map((item) => item.type),
    ["user_message", "command_execution", "assistant_message"],
  );
  const wakeupCommand = wakeupItems.find((item) => item.type === "command_execution");
  assert.include(JSON.stringify(wakeupCommand ?? null), "gh api repos/:owner/:repo/pulls/1/comments");
  const wakeupAssistantTexts = wakeupItems.flatMap((item) =>
    item.type === "assistant_message" ? [item.text] : [],
  );
  assert.deepEqual(wakeupAssistantTexts, [
    "Watcher fired: the bot review round is clean, nothing new to fix.",
  ]);

  // The watcher was started with run_in_background: its command item belongs
  // to run 1 but only completes when the task lifecycle concludes — here via
  // the task_updated/task_notification replayed into the wakeup run. The
  // terminal update must land on the ORIGINAL run-1 item (cross-run routing)
  // and append the notification summary to its output.
  const run1 = projection.runs.find((run) => run.ordinal === 1);
  assert.isDefined(run1);
  const watcherItem = projection.turnItems.find(
    (item) => item.runId === run1?.id && item.type === "command_execution",
  );
  assert.isDefined(watcherItem);
  assert.equal(watcherItem?.status, "completed");
  assert.include(
    watcherItem?.type === "command_execution" ? (watcherItem.output ?? "") : "",
    'Background command "Poll for new bot reviews on the PR" completed',
  );
  const watcherNode = projection.nodes.find((node) => node.id === watcherItem?.nodeId);
  assert.equal(watcherNode?.status, "completed");

  // The watcher is a local_bash task: lifecycle bookkeeping (task_updated /
  // task_notification replayed into the wakeup turn) must not project
  // subagents or child threads.
  assert.lengthOf(result.projections, 1);
  assert.lengthOf(projection.subagents, 0);
  assert.lengthOf(
    projection.nodes.filter((node) => node.kind === "subagent"),
    0,
  );

  // Follow-up run 3 proves the session stays usable after an attached wakeup.
  const followUpRun = projection.runs.find((run) => run.ordinal === 3);
  assert.isDefined(followUpRun);
  const followUpTexts = projection.turnItems.flatMap((item) =>
    item.runId === followUpRun?.id && item.type === "assistant_message" ? [item.text] : [],
  );
  assert.deepEqual(followUpTexts, ["claude provider wakeup fixture complete"]);
}

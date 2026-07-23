import { describe, expect, it } from "vite-plus/test";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import {
  deriveClaudeWorkflowRuns,
  findActiveClaudeWorkflowRunIndex,
  formatWorkflowModelName,
  inferClaudeWorkflowModelProvider,
  parseClaudeWorkflowDefinition,
} from "./claude-workflows";

describe("findActiveClaudeWorkflowRunIndex", () => {
  it("prefers the newest running workflow over paused and completed history", () => {
    expect(
      findActiveClaudeWorkflowRunIndex([
        { status: "paused" },
        { status: "running" },
        { status: "running" },
        { status: "completed" },
      ]),
    ).toBe(1);
  });

  it("falls back to the newest paused workflow when nothing is running", () => {
    expect(
      findActiveClaudeWorkflowRunIndex([
        { status: "completed" },
        { status: "paused" },
        { status: "paused" },
      ]),
    ).toBe(1);
  });

  it("returns null when there is no active workflow", () => {
    expect(
      findActiveClaudeWorkflowRunIndex([{ status: "completed" }, { status: "stopped" }]),
    ).toBeNull();
  });
});

describe("inferClaudeWorkflowModelProvider", () => {
  it("identifies Claude and OpenAI model families", () => {
    expect(inferClaudeWorkflowModelProvider("claude-opus-4-8")).toBe("claude");
    expect(inferClaudeWorkflowModelProvider("fable-5")).toBe("claude");
    expect(inferClaudeWorkflowModelProvider("openai/gpt-5.6-sol")).toBe("openai");
    expect(inferClaudeWorkflowModelProvider("o3-mini")).toBe("openai");
    expect(inferClaudeWorkflowModelProvider("custom-model")).toBeNull();
  });
});

describe("formatWorkflowModelName", () => {
  it("turns provider slugs into compact, trustworthy UI labels", () => {
    expect(formatWorkflowModelName("claude-fable-5[1m]")).toBe("Fable 5");
    expect(formatWorkflowModelName("claude-sonnet-5")).toBe("Sonnet 5");
    expect(formatWorkflowModelName("openai/gpt-5.6-sol")).toBe("GPT-5.6-Sol");
    expect(formatWorkflowModelName(undefined, "Runner")).toBe("Runner");
  });
});

describe("parseClaudeWorkflowDefinition", () => {
  it("reads workflow metadata, phases, and literal agent labels without executing the script", () => {
    const definition = parseClaudeWorkflowDefinition(`
      export const meta = {
        name: 'discovery-loop',
        description: 'Turn interviews into prototypes',
        phases: [
          { title: 'Extract', detail: 'Mine the interviews' },
          { title: 'Build', detail: 'Create prototypes' },
        ],
      }
      await agent('mine', { label: 'extract-001', phase: 'Extract' })
    `);

    expect(definition.name).toBe("discovery-loop");
    expect(definition.phases).toEqual([
      { title: "Extract", detail: "Mine the interviews" },
      { title: "Build", detail: "Create prototypes" },
    ]);
    expect(definition.agentPhases.get("extract-001")).toBe("Extract");
  });
});

describe("deriveClaudeWorkflowRuns", () => {
  it("combines Workflow output with streamed workflow and agent task activity", () => {
    const activities = [
      {
        id: "event-1",
        kind: "tool.completed",
        tone: "tool",
        summary: "Tool",
        turnId: "turn-1",
        createdAt: "2026-07-22T16:00:00.000Z",
        payload: {
          itemType: "dynamic_tool_call",
          data: {
            toolName: "Workflow",
            input: {
              script: `
                export const meta = { name: 'discovery-loop', phases: [{ title: 'Extract' }] }
                await agent('mine', { label: 'extract-001', phase: 'Extract' })
              `,
            },
            toolUseResult: {
              status: "async_launched",
              taskId: "workflow-task",
              workflowName: "discovery-loop",
              runId: "wf_123",
              summary: "Mine the interviews",
            },
          },
        },
      },
      {
        id: "event-2",
        kind: "task.started",
        tone: "info",
        summary: "workflow_agent task started",
        turnId: "turn-1",
        createdAt: "2026-07-22T16:00:01.000Z",
        payload: {
          taskId: "agent-1",
          taskType: "workflow_agent",
          workflowRunId: "wf_123",
          detail: "extract-001",
          subagentType: "workflow-subagent",
        },
      },
      {
        id: "event-3",
        kind: "task.progress",
        tone: "info",
        summary: "extract-001",
        turnId: "turn-1",
        createdAt: "2026-07-22T16:00:02.000Z",
        payload: {
          taskId: "agent-1",
          workflowRunId: "wf_123",
          title: "extract-001",
          lastToolName: "Read",
          usage: { total_tokens: 1500, tool_uses: 2, duration_ms: 8000 },
        },
      },
    ] as unknown as OrchestrationThreadActivity[];

    const [run] = deriveClaudeWorkflowRuns(activities);
    expect(run).toMatchObject({
      id: "wf_123",
      name: "discovery-loop",
      status: "running",
      tokens: 1500,
      toolUses: 2,
    });
    expect(run?.agents[0]).toMatchObject({
      id: "agent-1",
      title: "extract-001",
      phase: "Extract",
      lastToolName: "Read",
    });
  });

  it("merges the real Claude task-first event order and expands workflow_progress agents", () => {
    const script = `
      export const meta = {
        name: 't3-workflow-ui-check',
        description: 'Inspect and verify package names',
        phases: [{ title: 'Inspect' }, { title: 'Verify' }],
      }
    `;
    const activities = [
      {
        id: "event-1",
        kind: "task.started",
        tone: "info",
        summary: "local_workflow task started",
        createdAt: "2026-07-22T16:00:00.000Z",
        payload: {
          taskId: "workflow-task",
          taskType: "local_workflow",
          workflowName: "t3-workflow-ui-check",
          detail: "Inspect and verify package names",
          prompt: script,
        },
      },
      {
        id: "event-2",
        kind: "tool.completed",
        tone: "tool",
        summary: "Tool",
        createdAt: "2026-07-22T16:00:00.100Z",
        payload: {
          data: {
            toolName: "Workflow",
            input: { script },
            toolUseResult: {
              taskId: "workflow-task",
              workflowName: "t3-workflow-ui-check",
              runId: "wf_real",
            },
          },
        },
      },
      {
        id: "event-3",
        kind: "task.progress",
        tone: "info",
        summary: "Verify: verify-package-names",
        createdAt: "2026-07-22T16:00:10.000Z",
        payload: {
          taskId: "workflow-task",
          usage: { total_tokens: 45_201, tool_uses: 7, duration_ms: 10_578 },
          workflowProgress: [
            { type: "workflow_phase", index: 1, title: "Inspect" },
            { type: "workflow_phase", index: 2, title: "Verify" },
            {
              type: "workflow_agent",
              agentId: "agent-inspect",
              label: "inspect:root-package",
              phaseTitle: "Inspect",
              model: "claude-fable-5[1m]",
              delegatedProvider: "openai",
              delegatedModel: "gpt-5.6-sol",
              delegatedReasoningEffort: "high",
              delegatedVia: "mcp__codex__codex",
              claudeWrapperPrompt: "Route this packet through Codex exactly once.",
              delegatedToolUseId: "tool-codex-1",
              delegatedPrompt: "Read package.json and report its name.",
              delegatedToolInput:
                '{"prompt":"Read package.json and report its name.","config":{"model":"gpt-5.6-sol"}}',
              delegatedResultPreview: "Root package is @t3tools/monorepo.",
              delegatedRawResult:
                '{"threadId":"codex-thread-1","content":"Root package is @t3tools/monorepo."}',
              delegatedThreadId: "codex-thread-1",
              state: "done",
              promptPreview: "Read package.json",
              lastToolName: "StructuredOutput",
              resultPreview: '{"name":"@t3tools/monorepo"}',
              tokens: 14_869,
              toolCalls: 2,
              durationMs: 4_803,
            },
            {
              type: "workflow_agent",
              agentId: "agent-verify",
              label: "verify:package-names",
              phaseTitle: "Verify",
              state: "start",
              promptPreview: "Confirm both package names",
            },
          ],
        },
      },
      {
        id: "event-4",
        kind: "task.updated",
        tone: "info",
        summary: "Task updated",
        createdAt: "2026-07-22T16:00:11.000Z",
        payload: { taskId: "workflow-task", patch: { status: "completed" } },
      },
      {
        id: "event-5",
        kind: "task.updated",
        tone: "info",
        summary: "Task updated",
        createdAt: "2026-07-22T16:00:11.000Z",
        payload: { taskId: "workflow-task", patch: { status: "stopped" } },
      },
    ] as unknown as OrchestrationThreadActivity[];

    const runs = deriveClaudeWorkflowRuns(activities);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: "wf_real",
      taskId: "workflow-task",
      status: "completed",
      tokens: 45_201,
      toolUses: 7,
    });
    expect(runs[0]?.phases.map((phase) => phase.title)).toEqual(["Inspect", "Verify"]);
    expect(runs[0]?.agents).toEqual([
      expect.objectContaining({
        id: "agent-inspect",
        title: "inspect:root-package",
        phase: "Inspect",
        status: "completed",
        model: "claude-fable-5[1m]",
        delegatedProvider: "openai",
        delegatedModel: "gpt-5.6-sol",
        delegatedReasoningEffort: "high",
        delegatedVia: "mcp__codex__codex",
        claudeWrapperPrompt: "Route this packet through Codex exactly once.",
        delegatedToolUseId: "tool-codex-1",
        delegatedPrompt: "Read package.json and report its name.",
        delegatedToolInput:
          '{"prompt":"Read package.json and report its name.","config":{"model":"gpt-5.6-sol"}}',
        delegatedResultPreview: "Root package is @t3tools/monorepo.",
        delegatedRawResult:
          '{"threadId":"codex-thread-1","content":"Root package is @t3tools/monorepo."}',
        delegatedThreadId: "codex-thread-1",
        recentTools: ["StructuredOutput"],
        summary: '{"name":"@t3tools/monorepo"}',
      }),
      expect.objectContaining({
        id: "agent-verify",
        title: "verify:package-names",
        phase: "Verify",
        status: "completed",
      }),
    ]);
  });

  it("freezes paused workflow and agent clocks while preserving authoritative usage", () => {
    const startedAt = "2026-07-22T16:00:00.000Z";
    const progressAt = "2026-07-22T16:00:08.000Z";
    const pausedAt = "2026-07-22T16:00:20.000Z";
    const activities = [
      {
        id: "event-1",
        kind: "task.started",
        tone: "info",
        summary: "local_workflow task started",
        createdAt: startedAt,
        payload: {
          taskId: "workflow-task",
          taskType: "local_workflow",
          workflowName: "paused-workflow",
          prompt: `export const meta = { phases: [{ title: 'Map' }] }`,
        },
      },
      {
        id: "event-2",
        kind: "task.progress",
        tone: "info",
        summary: "Map",
        createdAt: progressAt,
        payload: {
          taskId: "workflow-task",
          usage: { totalTokens: 13_000, toolCalls: 1, durationMs: 8_000 },
          workflowProgress: [
            {
              type: "workflow_agent",
              agentId: "agent-map",
              label: "map",
              phaseTitle: "Map",
              state: "progress",
              startedAt: Date.parse(startedAt),
              lastProgressAt: Date.parse(progressAt),
              tokens: 13_000,
              toolCalls: 1,
            },
          ],
        },
      },
      {
        id: "event-3",
        kind: "task.updated",
        tone: "info",
        summary: "Task updated",
        createdAt: pausedAt,
        payload: {
          taskId: "workflow-task",
          patch: { status: "paused", reason: "thread_interrupted" },
        },
      },
    ] as unknown as OrchestrationThreadActivity[];

    const [run] = deriveClaudeWorkflowRuns(activities);
    expect(run).toMatchObject({
      status: "paused",
      tokens: 13_000,
      toolUses: 1,
      durationMs: 20_000,
    });
    expect(run?.phases[0]).toMatchObject({ status: "paused", durationMs: 20_000 });
    expect(run?.agents[0]).toMatchObject({
      status: "paused",
      tokens: 13_000,
      toolUses: 1,
      durationMs: 20_000,
      startedAtMs: Date.parse(startedAt),
      updatedAtMs: Date.parse(pausedAt),
    });
  });

  it("keeps an in-flight Codex activity separate from a verified final result", () => {
    const activities = [
      {
        id: "event-start",
        kind: "task.started",
        tone: "info",
        summary: "local_workflow task started",
        createdAt: "2026-07-22T16:00:00.000Z",
        payload: {
          taskId: "workflow-task",
          taskType: "local_workflow",
          workflowName: "codex-review",
        },
      },
      {
        id: "event-progress",
        kind: "task.progress",
        tone: "info",
        summary: "Codex review",
        createdAt: "2026-07-22T16:00:05.000Z",
        payload: {
          taskId: "workflow-task",
          workflowProgress: [
            {
              type: "workflow_agent",
              agentId: "agent-codex",
              label: "review:codex",
              phaseTitle: "Review",
              model: "claude-sonnet-5",
              state: "progress",
              delegationState: "requested",
              delegatedProvider: "openai",
              delegatedModel: "gpt-5.6-sol",
              delegatedReasoningEffort: "high",
              delegatedVia: "mcp__codex__codex",
              delegatedSandbox: "read-only",
              delegatedApprovalPolicy: "never",
              lastToolName: "mcp__codex__codex",
              lastToolSummary: "Waiting for the delegated result.",
            },
          ],
        },
      },
    ] as unknown as OrchestrationThreadActivity[];

    const agent = deriveClaudeWorkflowRuns(activities)[0]?.agents[0];
    expect(agent).toMatchObject({
      id: "agent-codex",
      delegationState: "requested",
      delegatedModel: "gpt-5.6-sol",
      delegatedSandbox: "read-only",
      delegatedApprovalPolicy: "never",
      activitySummary: "Waiting for the delegated result.",
    });
    expect(agent?.summary).toBeUndefined();
  });

  it("closes a stale running workflow when the authoritative provider roster is empty", () => {
    const activities = [
      {
        id: "event-1",
        kind: "task.started",
        tone: "info",
        summary: "local_workflow task started",
        createdAt: "2026-07-22T16:00:00.000Z",
        payload: {
          taskId: "workflow-task",
          taskType: "local_workflow",
          workflowName: "orphaned-workflow",
        },
      },
      {
        id: "event-2",
        kind: "task.roster",
        tone: "info",
        summary: "Background tasks updated",
        createdAt: "2026-07-22T16:00:10.000Z",
        payload: { tasks: [] },
      },
    ] as unknown as OrchestrationThreadActivity[];

    const [run] = deriveClaudeWorkflowRuns(activities);
    expect(run).toMatchObject({ status: "stopped", durationMs: 10_000 });
  });
});

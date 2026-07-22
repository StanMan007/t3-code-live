import { describe, expect, it } from "vite-plus/test";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import { deriveClaudeWorkflowRuns, parseClaudeWorkflowDefinition } from "./claude-workflows";

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
        summary: '{"name":"@t3tools/monorepo"}',
      }),
      expect.objectContaining({
        id: "agent-verify",
        title: "verify:package-names",
        phase: "Verify",
        status: "running",
      }),
    ]);
  });
});

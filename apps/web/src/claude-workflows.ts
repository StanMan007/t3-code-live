import type { OrchestrationThreadActivity } from "@t3tools/contracts";

export type ClaudeWorkflowStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "stopped";

export type ClaudeWorkflowModelProvider = "claude" | "openai" | null;
export type ClaudeWorkflowDelegationState = "requested" | "result_received";

export function inferClaudeWorkflowModelProvider(
  model: string | null | undefined,
): ClaudeWorkflowModelProvider {
  const normalized = model?.trim().toLowerCase();
  if (!normalized) return null;
  if (/(^|[/:._-])(claude|anthropic|opus|sonnet|haiku|fable)(?:$|[/:._-])/.test(normalized)) {
    return "claude";
  }
  if (/(^|[/:._-])(openai|chatgpt|gpt|codex|o[1345])(?:$|[/:._-])/.test(normalized)) {
    return "openai";
  }
  return null;
}

export function formatWorkflowModelName(
  model: string | null | undefined,
  fallback = "Model",
): string {
  const value = model?.trim();
  if (!value) return fallback;

  const normalized = value.toLowerCase();
  const familyMatch = normalized.match(
    /(?:^|[/:._-])(fable|sonnet|opus|haiku)[-_ ]?(\d+(?:[.-]\d+)*)/,
  );
  if (familyMatch) {
    const family = familyMatch[1]!;
    const version = familyMatch[2]?.replaceAll("-", ".");
    return `${family.charAt(0).toUpperCase()}${family.slice(1)}${version ? ` ${version}` : ""}`;
  }

  const gptMatch = normalized.match(/(?:^|[/:._-])gpt[-_ ]?(\d+(?:[.-]\d+)*)(?:[-_ ](sol))?/);
  if (gptMatch) {
    const version = gptMatch[1]?.replaceAll("-", ".");
    return `GPT-${version}${gptMatch[2] ? "-Sol" : ""}`;
  }

  return value
    .replace(/^anthropic[/:._-]+/i, "")
    .replace(/^claude[/:._-]+/i, "")
    .replace(/^openai[/:._-]+/i, "");
}

export interface ClaudeWorkflowAgent {
  id: string;
  title: string;
  phase: string;
  status: ClaudeWorkflowStatus;
  model?: string;
  subagentType?: string;
  delegatedModel?: string;
  delegatedProvider?: Exclude<ClaudeWorkflowModelProvider, null>;
  delegatedReasoningEffort?: string;
  delegatedVia?: string;
  delegationState?: ClaudeWorkflowDelegationState;
  claudeWrapperPrompt?: string;
  delegatedToolUseId?: string;
  delegatedPrompt?: string;
  delegatedToolInput?: string;
  delegatedSandbox?: string;
  delegatedApprovalPolicy?: string;
  delegatedResultPreview?: string;
  delegatedRawResult?: string;
  delegatedThreadId?: string;
  delegatedTokens?: number;
  delegatedToolUses?: number;
  prompt?: string;
  summary?: string;
  activitySummary?: string;
  lastToolName?: string;
  recentTools: string[];
  transcriptPath?: string;
  tokens: number;
  toolUses: number;
  durationMs: number;
  startedAtMs?: number;
  updatedAtMs?: number;
}

export interface ClaudeWorkflowPhase {
  title: string;
  detail?: string;
  agents: ClaudeWorkflowAgent[];
  tokens: number;
  toolUses: number;
  durationMs: number;
  status: ClaudeWorkflowStatus;
}

export interface ClaudeWorkflowRun {
  id: string;
  taskId: string;
  runId?: string;
  name: string;
  summary?: string;
  status: ClaudeWorkflowStatus;
  startedAt: string;
  updatedAt: string;
  transcriptDir?: string;
  scriptPath?: string;
  phases: ClaudeWorkflowPhase[];
  agents: ClaudeWorkflowAgent[];
  tokens: number;
  toolUses: number;
  durationMs: number;
}

export function findActiveClaudeWorkflowRunIndex(
  workflows: ReadonlyArray<Pick<ClaudeWorkflowRun, "status">>,
): number | null {
  const runningIndex = workflows.findIndex((workflow) => workflow.status === "running");
  if (runningIndex >= 0) return runningIndex;

  const pausedIndex = workflows.findIndex((workflow) => workflow.status === "paused");
  return pausedIndex >= 0 ? pausedIndex : null;
}

interface WorkflowDefinition {
  name?: string;
  description?: string;
  phases: Array<{ title: string; detail?: string }>;
  agentPhases: Map<string, string>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readDelegationState(
  value: unknown,
  fallback?: ClaudeWorkflowDelegationState,
): ClaudeWorkflowDelegationState | undefined {
  return value === "requested" || value === "result_received" ? value : fallback;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function readTimestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function observedDurationMs(startedAtMs: number | undefined, updatedAtMs: number | undefined) {
  if (startedAtMs === undefined || updatedAtMs === undefined) return 0;
  return Math.max(0, updatedAtMs - startedAtMs);
}

function readQuotedProperty(source: string, property: string): string | undefined {
  const match = source.match(
    new RegExp(`${property}\\s*:\\s*(["'\\\`])((?:\\\\.|(?!\\1)[\\s\\S])*)\\1`),
  );
  return match?.[2]?.replace(/\\([\\'"`])/g, "$1");
}

function balancedSlice(
  source: string,
  startIndex: number,
  openCharacter: string,
  closeCharacter: string,
): string | null {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let index = startIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === openCharacter) depth += 1;
    if (character === closeCharacter) {
      depth -= 1;
      if (depth === 0) return source.slice(startIndex, index + 1);
    }
  }
  return null;
}

export function parseClaudeWorkflowDefinition(script: string): WorkflowDefinition {
  const metaMarker = script.search(/export\s+const\s+meta\s*=/);
  const metaStart = metaMarker >= 0 ? script.indexOf("{", metaMarker) : -1;
  const metaSource = metaStart >= 0 ? balancedSlice(script, metaStart, "{", "}") : null;
  const phases: WorkflowDefinition["phases"] = [];

  if (metaSource) {
    const phasesMarker = metaSource.search(/\bphases\s*:/);
    const phasesStart = phasesMarker >= 0 ? metaSource.indexOf("[", phasesMarker) : -1;
    const phasesSource = phasesStart >= 0 ? balancedSlice(metaSource, phasesStart, "[", "]") : null;
    if (phasesSource) {
      const phaseObjectPattern = /\{[\s\S]*?\}/g;
      for (const match of phasesSource.matchAll(phaseObjectPattern)) {
        const title = readQuotedProperty(match[0], "title");
        if (!title) continue;
        const detail = readQuotedProperty(match[0], "detail");
        phases.push({ title, ...(detail ? { detail } : {}) });
      }
      if (phases.length === 0) {
        for (const match of phasesSource.matchAll(/(["'`])([^"'`]+)\1/g)) {
          if (match[2]) phases.push({ title: match[2] });
        }
      }
    }
  }

  const agentPhases = new Map<string, string>();
  for (const match of script.matchAll(/\{[^{}]*\blabel\s*:[^{}]*\bphase\s*:[^{}]*\}/g)) {
    const label = readQuotedProperty(match[0], "label");
    const phase = readQuotedProperty(match[0], "phase");
    if (label && phase) agentPhases.set(label, phase);
  }

  const name = metaSource ? readQuotedProperty(metaSource, "name") : undefined;
  const description = metaSource ? readQuotedProperty(metaSource, "description") : undefined;
  return {
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    phases,
    agentPhases,
  };
}

function normalizeStatus(value: unknown, fallback: ClaudeWorkflowStatus): ClaudeWorkflowStatus {
  if (
    value === "pending" ||
    value === "running" ||
    value === "paused" ||
    value === "completed" ||
    value === "failed" ||
    value === "stopped"
  ) {
    return value;
  }
  if (value === "killed") return "stopped";
  return fallback;
}

function preserveTerminalOutcome(
  previous: ClaudeWorkflowStatus,
  next: ClaudeWorkflowStatus,
): ClaudeWorkflowStatus {
  if ((previous === "completed" || previous === "failed") && next === "stopped") {
    return previous;
  }
  return next;
}

function workflowAgentStatus(value: unknown): ClaudeWorkflowStatus {
  if (value === "done" || value === "completed") return "completed";
  if (value === "error" || value === "failed") return "failed";
  if (value === "stopped" || value === "killed") return "stopped";
  if (value === "paused") return "paused";
  if (value === "queued" || value === "pending") return "pending";
  return "running";
}

function usageFromPayload(payload: Record<string, unknown> | null) {
  const usage = asRecord(payload?.usage);
  return {
    tokens: readNumber(usage?.total_tokens ?? usage?.totalTokens),
    toolUses: readNumber(
      usage?.tool_uses ?? usage?.toolUses ?? usage?.tool_calls ?? usage?.toolCalls,
    ),
    durationMs: readNumber(usage?.duration_ms ?? usage?.durationMs),
  };
}

function appendRecentTool(
  recentTools: ReadonlyArray<string> | undefined,
  toolName: string | undefined,
): string[] {
  if (!toolName) return [...(recentTools ?? [])];
  const next = [...(recentTools ?? [])].filter((existing) => existing !== toolName);
  next.push(toolName);
  return next.slice(-6);
}

function workflowToolData(activity: OrchestrationThreadActivity): {
  output: Record<string, unknown>;
  definition: WorkflowDefinition;
} | null {
  if (activity.kind !== "tool.completed") return null;
  const payload = asRecord(activity.payload);
  const data = asRecord(payload?.data);
  if (!data || readString(data.toolName)?.toLowerCase() !== "workflow") return null;
  const output = asRecord(data?.toolUseResult);
  if (!output || !readString(output.taskId)) return null;
  const input = asRecord(data.input);
  const script = readString(input?.script) ?? readString(data.workflowScript);
  return {
    output,
    definition: script
      ? parseClaudeWorkflowDefinition(script)
      : { phases: [], agentPhases: new Map() },
  };
}

export function deriveClaudeWorkflowRuns(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ClaudeWorkflowRun[] {
  const ordered = [...activities].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  const runs = new Map<string, ClaudeWorkflowRun>();
  const runByTaskId = new Map<string, string>();
  const definitions = new Map<string, WorkflowDefinition>();
  const pendingAgents = new Map<string, ClaudeWorkflowAgent>();

  const ensureRun = (input: {
    taskId: string;
    runId?: string;
    name?: string;
    summary?: string;
    startedAt: string;
    transcriptDir?: string;
    scriptPath?: string;
    definition?: WorkflowDefinition;
  }): ClaudeWorkflowRun => {
    let id = runByTaskId.get(input.taskId) ?? input.runId ?? input.taskId;
    let existing = runs.get(id);
    if (existing && input.runId && id !== input.runId) {
      runs.delete(id);
      const definition = definitions.get(id);
      definitions.delete(id);
      existing.id = input.runId;
      id = input.runId;
      runs.set(id, existing);
      if (definition) definitions.set(id, definition);
    }
    if (existing) {
      if (input.name) existing.name = input.name;
      if (input.summary) existing.summary = input.summary;
      if (input.runId) existing.runId = input.runId;
      if (input.transcriptDir) existing.transcriptDir = input.transcriptDir;
      if (input.scriptPath) existing.scriptPath = input.scriptPath;
      existing.updatedAt = input.startedAt;
      runByTaskId.set(input.taskId, id);
      if (input.definition) definitions.set(id, input.definition);
      return existing;
    }
    const runSummary = input.summary ?? input.definition?.description;
    const run: ClaudeWorkflowRun = {
      id,
      taskId: input.taskId,
      ...(input.runId ? { runId: input.runId } : {}),
      name: input.name ?? input.definition?.name ?? "Workflow",
      ...(runSummary ? { summary: runSummary } : {}),
      status: "running",
      startedAt: input.startedAt,
      updatedAt: input.startedAt,
      ...(input.transcriptDir ? { transcriptDir: input.transcriptDir } : {}),
      ...(input.scriptPath ? { scriptPath: input.scriptPath } : {}),
      phases: [],
      agents: [],
      tokens: 0,
      toolUses: 0,
      durationMs: 0,
    };
    runs.set(id, run);
    runByTaskId.set(input.taskId, id);
    if (input.definition) definitions.set(id, input.definition);
    return run;
  };

  for (const activity of ordered) {
    const workflowTool = workflowToolData(activity);
    if (workflowTool) {
      const output = workflowTool.output;
      const taskId = readString(output.taskId)!;
      const runId = readString(output.runId);
      const transcriptDir = readString(output.transcriptDir);
      const scriptPath = readString(output.scriptPath);
      const workflowName = readString(output.workflowName) ?? workflowTool.definition.name;
      const workflowSummary = readString(output.summary) ?? workflowTool.definition.description;
      ensureRun({
        taskId,
        ...(runId ? { runId } : {}),
        ...(workflowName ? { name: workflowName } : {}),
        ...(workflowSummary ? { summary: workflowSummary } : {}),
        startedAt: activity.createdAt,
        ...(transcriptDir ? { transcriptDir } : {}),
        ...(scriptPath ? { scriptPath } : {}),
        definition: workflowTool.definition,
      });
      continue;
    }

    const payload = asRecord(activity.payload);
    if (activity.kind === "task.roster") {
      const activeTaskIds = new Set(
        (Array.isArray(payload?.tasks) ? payload.tasks : []).flatMap((task) => {
          const record = asRecord(task);
          const rosterTaskId = readString(record?.task_id) ?? readString(record?.taskId);
          return rosterTaskId ? [rosterTaskId] : [];
        }),
      );
      for (const existingRun of runs.values()) {
        if (existingRun.status === "running" && !activeTaskIds.has(existingRun.taskId)) {
          existingRun.status = "stopped";
          existingRun.updatedAt = activity.createdAt;
        }
      }
      continue;
    }
    const taskId = readString(payload?.taskId);
    if (!taskId) continue;
    const taskType = readString(payload?.taskType);
    const workflowRunId = readString(payload?.workflowRunId);

    if (activity.kind === "task.started" && taskType === "local_workflow") {
      const workflowName = readString(payload?.workflowName) ?? readString(payload?.detail);
      const workflowSummary = readString(payload?.detail);
      const workflowScript = readString(payload?.prompt);
      ensureRun({
        taskId,
        ...(workflowName ? { name: workflowName } : {}),
        ...(workflowSummary ? { summary: workflowSummary } : {}),
        startedAt: activity.createdAt,
        ...(workflowScript ? { definition: parseClaudeWorkflowDefinition(workflowScript) } : {}),
      });
      continue;
    }

    const directRunId = workflowRunId ?? runByTaskId.get(taskId);
    const run = directRunId ? runs.get(directRunId) : undefined;
    if (run && taskId === run.taskId) {
      if (activity.kind === "task.updated") {
        const patch = asRecord(payload?.patch);
        run.status = preserveTerminalOutcome(
          run.status,
          normalizeStatus(patch?.status, run.status),
        );
      } else if (activity.kind === "task.completed") {
        run.status = normalizeStatus(payload?.status, "completed");
        const summary = readString(payload?.summary);
        if (summary) run.summary = summary;
      } else if (activity.kind === "task.progress") {
        if (run.status === "paused") run.status = "running";
        const usage = usageFromPayload(payload);
        run.tokens = Math.max(run.tokens, usage.tokens);
        run.toolUses = Math.max(run.toolUses, usage.toolUses);
        run.durationMs = Math.max(run.durationMs, usage.durationMs);
        const workflowProgress = Array.isArray(payload?.workflowProgress)
          ? payload.workflowProgress
          : [];
        for (const progressEntry of workflowProgress) {
          const entry = asRecord(progressEntry);
          if (readString(entry?.type) !== "workflow_agent") continue;
          const agentId = readString(entry?.agentId) ?? readString(entry?.label);
          const title = readString(entry?.label);
          if (!agentId || !title) continue;
          const previous = pendingAgents.get(agentId);
          const phase =
            readString(entry?.phaseTitle) ??
            readString(entry?.phase) ??
            previous?.phase ??
            "Agents";
          const model = readString(entry?.model) ?? previous?.model;
          const subagentType = readString(entry?.subagentType) ?? previous?.subagentType;
          const delegatedModel = readString(entry?.delegatedModel) ?? previous?.delegatedModel;
          const delegatedProviderValue = readString(entry?.delegatedProvider);
          const delegatedProvider =
            delegatedProviderValue === "claude" || delegatedProviderValue === "openai"
              ? delegatedProviderValue
              : previous?.delegatedProvider;
          const delegatedReasoningEffort =
            readString(entry?.delegatedReasoningEffort) ?? previous?.delegatedReasoningEffort;
          const delegatedVia = readString(entry?.delegatedVia) ?? previous?.delegatedVia;
          const delegationState = readDelegationState(
            entry?.delegationState,
            previous?.delegationState ??
              (delegatedProvider && delegatedVia ? "result_received" : undefined),
          );
          const claudeWrapperPrompt =
            readString(entry?.claudeWrapperPrompt) ?? previous?.claudeWrapperPrompt;
          const delegatedToolUseId =
            readString(entry?.delegatedToolUseId) ?? previous?.delegatedToolUseId;
          const delegatedPrompt = readString(entry?.delegatedPrompt) ?? previous?.delegatedPrompt;
          const delegatedToolInput =
            readString(entry?.delegatedToolInput) ?? previous?.delegatedToolInput;
          const delegatedSandbox =
            readString(entry?.delegatedSandbox) ?? previous?.delegatedSandbox;
          const delegatedApprovalPolicy =
            readString(entry?.delegatedApprovalPolicy) ?? previous?.delegatedApprovalPolicy;
          const delegatedResultPreview =
            readString(entry?.delegatedResultPreview) ?? previous?.delegatedResultPreview;
          const delegatedRawResult =
            readString(entry?.delegatedRawResult) ?? previous?.delegatedRawResult;
          const delegatedThreadId =
            readString(entry?.delegatedThreadId) ?? previous?.delegatedThreadId;
          const delegatedTokensValue = readNumber(entry?.delegatedTokens);
          const delegatedTokens =
            delegatedTokensValue > 0 ? delegatedTokensValue : previous?.delegatedTokens;
          const delegatedToolUsesValue = readNumber(
            entry?.delegatedToolCalls ?? entry?.delegatedToolUses,
          );
          const delegatedToolUses =
            delegatedToolUsesValue > 0 ? delegatedToolUsesValue : previous?.delegatedToolUses;
          const prompt = readString(entry?.promptPreview) ?? previous?.prompt;
          const result = readString(entry?.resultPreview);
          const toolSummary = readString(entry?.lastToolSummary);
          const summary = result ?? previous?.summary;
          const activitySummary = toolSummary ?? previous?.activitySummary;
          const lastToolName = readString(entry?.lastToolName) ?? previous?.lastToolName;
          const startedAtMs =
            readTimestampMs(entry?.startedAt) ??
            readTimestampMs(entry?.queuedAt) ??
            previous?.startedAtMs ??
            readTimestampMs(activity.createdAt);
          const updatedAtMs =
            readTimestampMs(entry?.lastProgressAt) ?? readTimestampMs(activity.createdAt);
          const agent: ClaudeWorkflowAgent = {
            id: agentId,
            title,
            phase,
            status: workflowAgentStatus(entry?.state),
            ...(model ? { model } : {}),
            ...(subagentType ? { subagentType } : {}),
            ...(delegatedModel ? { delegatedModel } : {}),
            ...(delegatedProvider ? { delegatedProvider } : {}),
            ...(delegatedReasoningEffort ? { delegatedReasoningEffort } : {}),
            ...(delegatedVia ? { delegatedVia } : {}),
            ...(delegationState ? { delegationState } : {}),
            ...(claudeWrapperPrompt ? { claudeWrapperPrompt } : {}),
            ...(delegatedToolUseId ? { delegatedToolUseId } : {}),
            ...(delegatedPrompt ? { delegatedPrompt } : {}),
            ...(delegatedToolInput ? { delegatedToolInput } : {}),
            ...(delegatedSandbox ? { delegatedSandbox } : {}),
            ...(delegatedApprovalPolicy ? { delegatedApprovalPolicy } : {}),
            ...(delegatedResultPreview ? { delegatedResultPreview } : {}),
            ...(delegatedRawResult ? { delegatedRawResult } : {}),
            ...(delegatedThreadId ? { delegatedThreadId } : {}),
            ...(delegatedTokens !== undefined ? { delegatedTokens } : {}),
            ...(delegatedToolUses !== undefined ? { delegatedToolUses } : {}),
            ...(prompt ? { prompt } : {}),
            ...(summary ? { summary } : {}),
            ...(activitySummary ? { activitySummary } : {}),
            ...(lastToolName ? { lastToolName } : {}),
            recentTools: appendRecentTool(previous?.recentTools, lastToolName),
            tokens: Math.max(previous?.tokens ?? 0, readNumber(entry?.tokens)),
            toolUses: Math.max(previous?.toolUses ?? 0, readNumber(entry?.toolCalls)),
            durationMs: Math.max(
              previous?.durationMs ?? 0,
              readNumber(entry?.durationMs),
              observedDurationMs(startedAtMs, updatedAtMs),
            ),
            ...(startedAtMs !== undefined ? { startedAtMs } : {}),
            ...(updatedAtMs !== undefined ? { updatedAtMs } : {}),
          };
          pendingAgents.set(agentId, agent);
          const agentIndex = run.agents.findIndex((candidate) => candidate.id === agentId);
          if (agentIndex >= 0) run.agents[agentIndex] = agent;
          else run.agents.push(agent);
        }
      }
      run.updatedAt = activity.createdAt;
      continue;
    }

    if (
      taskType === "workflow_agent" ||
      workflowRunId ||
      (taskType === "local_agent" && runs.size === 1)
    ) {
      const targetRun = workflowRunId
        ? runs.get(workflowRunId)
        : runs.size === 1
          ? Array.from(runs.values())[0]
          : undefined;
      if (!targetRun) continue;
      const previous = pendingAgents.get(taskId);
      const usage = usageFromPayload(payload);
      const definition = definitions.get(targetRun.id);
      const title =
        readString(payload?.title) ??
        readString(payload?.detail) ??
        readString(payload?.description) ??
        previous?.title ??
        `agent-${taskId.slice(0, 7)}`;
      const subagentType = readString(payload?.subagentType) ?? previous?.subagentType;
      const model = readString(payload?.model) ?? previous?.model;
      const delegatedModel = readString(payload?.delegatedModel) ?? previous?.delegatedModel;
      const delegatedProviderValue = readString(payload?.delegatedProvider);
      const delegatedProvider =
        delegatedProviderValue === "claude" || delegatedProviderValue === "openai"
          ? delegatedProviderValue
          : previous?.delegatedProvider;
      const delegatedReasoningEffort =
        readString(payload?.delegatedReasoningEffort) ?? previous?.delegatedReasoningEffort;
      const delegatedVia = readString(payload?.delegatedVia) ?? previous?.delegatedVia;
      const delegationState = readDelegationState(
        payload?.delegationState,
        previous?.delegationState ??
          (delegatedProvider && delegatedVia ? "result_received" : undefined),
      );
      const claudeWrapperPrompt =
        readString(payload?.claudeWrapperPrompt) ?? previous?.claudeWrapperPrompt;
      const delegatedToolUseId =
        readString(payload?.delegatedToolUseId) ?? previous?.delegatedToolUseId;
      const delegatedPrompt = readString(payload?.delegatedPrompt) ?? previous?.delegatedPrompt;
      const delegatedToolInput =
        readString(payload?.delegatedToolInput) ?? previous?.delegatedToolInput;
      const delegatedSandbox = readString(payload?.delegatedSandbox) ?? previous?.delegatedSandbox;
      const delegatedApprovalPolicy =
        readString(payload?.delegatedApprovalPolicy) ?? previous?.delegatedApprovalPolicy;
      const delegatedResultPreview =
        readString(payload?.delegatedResultPreview) ?? previous?.delegatedResultPreview;
      const delegatedRawResult =
        readString(payload?.delegatedRawResult) ?? previous?.delegatedRawResult;
      const delegatedThreadId =
        readString(payload?.delegatedThreadId) ?? previous?.delegatedThreadId;
      const delegatedTokensValue = readNumber(payload?.delegatedTokens);
      const delegatedTokens =
        delegatedTokensValue > 0 ? delegatedTokensValue : previous?.delegatedTokens;
      const delegatedToolUsesValue = readNumber(
        payload?.delegatedToolCalls ?? payload?.delegatedToolUses,
      );
      const delegatedToolUses =
        delegatedToolUsesValue > 0 ? delegatedToolUsesValue : previous?.delegatedToolUses;
      const prompt = readString(payload?.prompt) ?? previous?.prompt;
      const summary = readString(payload?.summary) ?? previous?.summary;
      const activitySummary = readString(payload?.lastToolSummary) ?? previous?.activitySummary;
      const lastToolName = readString(payload?.lastToolName) ?? previous?.lastToolName;
      const transcriptPath = readString(payload?.transcriptPath) ?? previous?.transcriptPath;
      const activityTimestampMs = readTimestampMs(activity.createdAt);
      const startedAtMs = previous?.startedAtMs ?? activityTimestampMs;
      const agent: ClaudeWorkflowAgent = {
        id: taskId,
        title,
        phase:
          readString(payload?.phase) ??
          definition?.agentPhases.get(title) ??
          previous?.phase ??
          "Active agents",
        status: preserveTerminalOutcome(
          previous?.status ?? "running",
          activity.kind === "task.completed"
            ? normalizeStatus(payload?.status, "completed")
            : activity.kind === "task.updated"
              ? normalizeStatus(asRecord(payload?.patch)?.status, previous?.status ?? "running")
              : "running",
        ),
        ...(model ? { model } : {}),
        ...(subagentType ? { subagentType } : {}),
        ...(delegatedModel ? { delegatedModel } : {}),
        ...(delegatedProvider ? { delegatedProvider } : {}),
        ...(delegatedReasoningEffort ? { delegatedReasoningEffort } : {}),
        ...(delegatedVia ? { delegatedVia } : {}),
        ...(delegationState ? { delegationState } : {}),
        ...(claudeWrapperPrompt ? { claudeWrapperPrompt } : {}),
        ...(delegatedToolUseId ? { delegatedToolUseId } : {}),
        ...(delegatedPrompt ? { delegatedPrompt } : {}),
        ...(delegatedToolInput ? { delegatedToolInput } : {}),
        ...(delegatedSandbox ? { delegatedSandbox } : {}),
        ...(delegatedApprovalPolicy ? { delegatedApprovalPolicy } : {}),
        ...(delegatedResultPreview ? { delegatedResultPreview } : {}),
        ...(delegatedRawResult ? { delegatedRawResult } : {}),
        ...(delegatedThreadId ? { delegatedThreadId } : {}),
        ...(delegatedTokens !== undefined ? { delegatedTokens } : {}),
        ...(delegatedToolUses !== undefined ? { delegatedToolUses } : {}),
        ...(prompt ? { prompt } : {}),
        ...(summary ? { summary } : {}),
        ...(activitySummary ? { activitySummary } : {}),
        ...(lastToolName ? { lastToolName } : {}),
        recentTools: appendRecentTool(previous?.recentTools, lastToolName),
        ...(transcriptPath ? { transcriptPath } : {}),
        tokens: Math.max(previous?.tokens ?? 0, usage.tokens),
        toolUses: Math.max(previous?.toolUses ?? 0, usage.toolUses),
        durationMs: Math.max(
          previous?.durationMs ?? 0,
          usage.durationMs,
          observedDurationMs(startedAtMs, activityTimestampMs),
        ),
        ...(startedAtMs !== undefined ? { startedAtMs } : {}),
        ...(activityTimestampMs !== undefined ? { updatedAtMs: activityTimestampMs } : {}),
      };
      pendingAgents.set(taskId, agent);
      const existingIndex = targetRun.agents.findIndex((candidate) => candidate.id === taskId);
      if (existingIndex >= 0) targetRun.agents[existingIndex] = agent;
      else targetRun.agents.push(agent);
      targetRun.updatedAt = activity.createdAt;
    }
  }

  for (const run of runs.values()) {
    const runUpdatedAtMs = readTimestampMs(run.updatedAt);
    const runStartedAtMs = readTimestampMs(run.startedAt);
    if (run.status !== "running" && run.status !== "pending") {
      for (const agent of run.agents) {
        if (agent.status === "running" || agent.status === "pending") {
          agent.status = run.status;
          if (runUpdatedAtMs !== undefined) agent.updatedAtMs = runUpdatedAtMs;
          agent.durationMs = Math.max(
            agent.durationMs,
            observedDurationMs(agent.startedAtMs, runUpdatedAtMs),
          );
        }
      }
      run.durationMs = Math.max(run.durationMs, observedDurationMs(runStartedAtMs, runUpdatedAtMs));
    }
    const definition = definitions.get(run.id);
    const phaseDefinitions = definition?.phases ?? [];
    const phaseTitles = phaseDefinitions.map((phase) => phase.title);
    for (const agent of run.agents) {
      if (!phaseTitles.includes(agent.phase)) phaseTitles.push(agent.phase);
    }
    run.phases = phaseTitles.map((title) => {
      const agents = run.agents.filter((agent) => agent.phase === title);
      const definitionPhase = phaseDefinitions.find((phase) => phase.title === title);
      const statuses = new Set(agents.map((agent) => agent.status));
      const status: ClaudeWorkflowStatus =
        run.status === "paused" || run.status === "failed" || run.status === "stopped"
          ? run.status
          : statuses.has("running")
            ? "running"
            : statuses.has("paused")
              ? "paused"
              : agents.length > 0 && agents.every((agent) => agent.status === "completed")
                ? "completed"
                : run.status === "completed"
                  ? "completed"
                  : "pending";
      return {
        title,
        ...(definitionPhase?.detail ? { detail: definitionPhase.detail } : {}),
        agents,
        tokens: agents.reduce((total, agent) => total + agent.tokens, 0),
        toolUses: agents.reduce((total, agent) => total + agent.toolUses, 0),
        durationMs: Math.max(0, ...agents.map((agent) => agent.durationMs)),
        status,
      };
    });
    run.tokens = Math.max(
      run.tokens,
      run.agents.reduce((total, agent) => total + agent.tokens, 0),
    );
    run.toolUses = Math.max(
      run.toolUses,
      run.agents.reduce((total, agent) => total + agent.toolUses, 0),
    );
    run.durationMs = Math.max(0, run.durationMs, ...run.agents.map((agent) => agent.durationMs));
  }

  return Array.from(runs.values()).toSorted((left, right) =>
    right.startedAt.localeCompare(left.startedAt),
  );
}

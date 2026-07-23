import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleIcon,
  Clock3Icon,
  GitBranchIcon,
  LoaderCircleIcon,
  PauseIcon,
  SquareIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deriveClaudeWorkflowRuns,
  findActiveClaudeWorkflowRunIndex,
  formatWorkflowModelName,
  inferClaudeWorkflowModelProvider,
  type ClaudeWorkflowAgent,
  type ClaudeWorkflowPhase,
  type ClaudeWorkflowRun,
  type ClaudeWorkflowStatus,
} from "../../claude-workflows";
import {
  onClaudeWorkflowNavigatorOpen,
  requestClaudeWorkflowNavigatorOpen,
} from "../../claudeWorkflowNavigatorBus";
import ChatMarkdown from "../ChatMarkdown";
import { ClaudeAI, OpenAI } from "../Icons";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { cn } from "~/lib/utils";

function compactNumber(value: number): string {
  if (value < 1_000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}

function timestampMs(value: string | number): number {
  return typeof value === "number" ? value : Date.parse(value);
}

function elapsedLabel(durationMs: number, startedAt?: string | number, nowMs = Date.now()): string {
  const derivedDuration = startedAt !== undefined ? Math.max(0, nowMs - timestampMs(startedAt)) : 0;
  const seconds = Math.floor(Math.max(durationMs, derivedDuration) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function ElapsedText(props: { durationMs: number; startedAt?: string | number | undefined }) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (props.startedAt === undefined) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [props.startedAt]);

  return elapsedLabel(props.durationMs, props.startedAt, nowMs);
}

function StatusMark(props: { status: ClaudeWorkflowStatus; className?: string }) {
  if (props.status === "completed") {
    return <CheckIcon className={cn("size-3.5 text-emerald-400", props.className)} />;
  }
  if (props.status === "running") {
    return (
      <LoaderCircleIcon className={cn("size-3.5 animate-spin text-sky-400", props.className)} />
    );
  }
  if (props.status === "paused") {
    return <PauseIcon className={cn("size-3.5 text-amber-400", props.className)} />;
  }
  if (props.status === "failed" || props.status === "stopped") {
    return <XIcon className={cn("size-3.5 text-rose-400", props.className)} />;
  }
  return <CircleIcon className={cn("size-3 text-muted-foreground/35", props.className)} />;
}

function RunMetrics(props: {
  label?: string;
  tokens: number;
  toolUses: number;
  durationMs: number;
  startedAt?: string | number | undefined;
}) {
  return (
    <span className="flex shrink-0 items-center gap-2 font-mono text-[10px] text-muted-foreground/55">
      {props.label ? (
        <span className="text-[8px] uppercase tracking-[0.08em] text-muted-foreground/35">
          {props.label}
        </span>
      ) : null}
      {props.tokens > 0 ? <span>{compactNumber(props.tokens)} tok</span> : null}
      {props.toolUses > 0 ? (
        <span className="inline-flex items-center gap-1">
          <WrenchIcon className="size-2.5" /> {props.toolUses}
        </span>
      ) : null}
      <span className="inline-flex items-center gap-1">
        <Clock3Icon className="size-2.5" />
        <ElapsedText durationMs={props.durationMs} startedAt={props.startedAt} />
      </span>
    </span>
  );
}

function phaseStartedAt(phase: ClaudeWorkflowPhase): number | undefined {
  const startedAtValues = phase.agents.flatMap((agent) =>
    agent.status === "running" && agent.startedAtMs !== undefined ? [agent.startedAtMs] : [],
  );
  return startedAtValues.length > 0 ? Math.min(...startedAtValues) : undefined;
}

function delegationCounts(agents: ReadonlyArray<ClaudeWorkflowAgent>) {
  return {
    requested: agents.filter((agent) => agent.delegationState !== undefined).length,
    results: agents.filter((agent) => agent.delegationState === "result_received").length,
    finalized: agents.filter((agent) => agent.status === "completed").length,
  };
}

function workflowProgressLabel(agents: ReadonlyArray<ClaudeWorkflowAgent>): string {
  const counts = delegationCounts(agents);
  if (counts.requested > 0) {
    return `${counts.results}/${counts.requested} Codex results · ${counts.finalized}/${agents.length} finalized`;
  }
  return `${counts.finalized}/${agents.length} complete`;
}

function workflowDockStatus(run: ClaudeWorkflowRun): {
  label: string;
  tone: "working" | "waiting" | "paused" | "finalizing" | "completed" | "failed";
} {
  if (run.status === "completed") return { label: "Completed", tone: "completed" };
  if (run.status === "failed") return { label: "Failed", tone: "failed" };
  if (run.status === "stopped") return { label: "Stopped", tone: "paused" };
  const waitingAgent = run.agents.find((agent) => agent.delegationState === "requested");
  if (waitingAgent) {
    return {
      label: `Waiting for ${formatWorkflowModelName(waitingAgent.delegatedModel, "Codex")}`,
      tone: "waiting",
    };
  }
  if (run.status === "paused") return { label: "Paused", tone: "paused" };
  const counts = delegationCounts(run.agents);
  if (counts.results > 0 && counts.finalized < run.agents.length) {
    return { label: "Finalizing", tone: "finalizing" };
  }
  return {
    label: "Working",
    tone: "working",
  };
}

function agentActivityLabel(agent: ClaudeWorkflowAgent): string | null {
  const runnerModel = formatWorkflowModelName(agent.model, "Runner");
  const delegatedModel = formatWorkflowModelName(agent.delegatedModel, "Codex");
  if (agent.status === "paused") return "Paused";
  if (agent.status === "failed") return "Failed";
  if (agent.status === "stopped") return "Stopped";
  if (agent.status === "completed") return "Finalized";
  if (agent.delegationState === "result_received") {
    return `${runnerModel} · ${agent.lastToolName ?? `finalizing ${delegatedModel} result`}`;
  }
  if (agent.delegationState === "requested") {
    return `${delegatedModel} · ${agent.lastToolName ?? "delegated call"} running`;
  }
  if (agent.lastToolName) return `${runnerModel} · ${agent.lastToolName}`;
  return agent.status === "running" ? "Starting wrapper" : null;
}

function workflowRunnerModel(
  agents: ReadonlyArray<ClaudeWorkflowAgent>,
  fallback?: string | null,
): string {
  const models = Array.from(
    new Set(agents.flatMap((agent) => (agent.model ? [formatWorkflowModelName(agent.model)] : []))),
  );
  if (models.length === 1) return models[0]!;
  if (models.length > 1) return "Mixed runners";
  return formatWorkflowModelName(fallback, "Runner");
}

function PhaseRow(props: {
  phase: ClaudeWorkflowPhase;
  selected: boolean;
  index: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
        props.selected
          ? "bg-white/[0.07] text-foreground"
          : "text-muted-foreground/65 hover:bg-white/[0.04] hover:text-foreground/85",
      )}
      onClick={props.onSelect}
    >
      <StatusMark status={props.phase.status} />
      <span className="w-3 shrink-0 font-mono text-[10px] text-muted-foreground/35">
        {props.index + 1}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px]">{props.phase.title}</span>
      <span className="font-mono text-[10px] text-muted-foreground/45">
        {delegationCounts(props.phase.agents).requested > 0
          ? `${delegationCounts(props.phase.agents).results}/${delegationCounts(props.phase.agents).requested} results`
          : `${delegationCounts(props.phase.agents).finalized}/${props.phase.agents.length}`}
      </span>
    </button>
  );
}

function WorkflowModelLabel(props: { model: string; provider?: "claude" | "openai" | null }) {
  const provider = props.provider ?? inferClaudeWorkflowModelProvider(props.model);
  const ProviderLogo = provider === "claude" ? ClaudeAI : provider === "openai" ? OpenAI : null;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {ProviderLogo ? (
        <ProviderLogo
          aria-hidden="true"
          className={cn("size-3 shrink-0", provider === "claude" && "opacity-90")}
        />
      ) : null}
      <span className="truncate" title={props.model}>
        {formatWorkflowModelName(props.model)}
      </span>
    </span>
  );
}

function WorkflowModelAttribution(props: { agent: ClaudeWorkflowAgent }) {
  const wrapperModel = props.agent.model ?? "Claude wrapper";
  const delegatedModel = props.agent.delegatedModel ?? "Codex · model not reported";
  const hasDelegation = Boolean(props.agent.delegatedProvider && props.agent.delegatedVia);
  const verified = props.agent.delegationState !== "requested";
  const title = hasDelegation
    ? `Runner: ${wrapperModel}. ${verified ? "Verified result from" : "Requested"} ${delegatedModel} via ${props.agent.delegatedVia}${props.agent.delegatedReasoningEffort ? ` (${props.agent.delegatedReasoningEffort} reasoning)` : ""}.`
    : `Runner: ${wrapperModel}.`;

  return (
    <span className="flex min-w-0 items-center gap-1.5" title={title}>
      <WorkflowModelLabel model={wrapperModel} provider="claude" />
      {hasDelegation ? (
        <>
          <ArrowRightIcon className="size-2.5 shrink-0 text-muted-foreground/30" />
          <span className={cn("min-w-0", !verified && "opacity-55")}>
            <WorkflowModelLabel
              model={delegatedModel}
              provider={props.agent.delegatedProvider ?? null}
            />
          </span>
          {!verified ? (
            <span className="shrink-0 text-[8px] uppercase tracking-[0.08em] text-sky-300/55">
              requested
            </span>
          ) : null}
        </>
      ) : null}
    </span>
  );
}

function AgentUsageSummary(props: { agent: ClaudeWorkflowAgent }) {
  const codexUsageReported =
    props.agent.delegatedTokens !== undefined || props.agent.delegatedToolUses !== undefined;
  const codexState =
    props.agent.delegationState === "requested"
      ? "running"
      : props.agent.delegationState === "result_received"
        ? "result ready"
        : "—";

  return (
    <span className="grid justify-items-end gap-0.5 font-mono text-[9px] leading-tight">
      <span
        className="flex max-w-full items-center justify-end gap-1.5 text-muted-foreground/55"
        title={`${formatWorkflowModelName(props.agent.model, "Runner")} usage`}
      >
        <ClaudeAI aria-hidden="true" className="size-2.5 shrink-0 opacity-65" />
        <span className="shrink-0">{compactNumber(props.agent.tokens)} tok</span>
        <span className="shrink-0 text-muted-foreground/35">
          {props.agent.toolUses} {props.agent.toolUses === 1 ? "tool" : "tools"}
        </span>
      </span>
      {props.agent.delegatedProvider ? (
        <span
          className={cn(
            "flex max-w-full items-center justify-end gap-1.5",
            props.agent.delegationState === "requested"
              ? "text-sky-300/65"
              : "text-muted-foreground/45",
          )}
          title={`${formatWorkflowModelName(props.agent.delegatedModel, "Codex")} usage`}
        >
          <OpenAI aria-hidden="true" className="size-2.5 shrink-0 opacity-65" />
          {codexUsageReported ? (
            <>
              <span className="shrink-0">
                {props.agent.delegatedTokens !== undefined
                  ? `${compactNumber(props.agent.delegatedTokens)} tok`
                  : "tokens —"}
              </span>
              <span className="shrink-0 text-muted-foreground/35">
                {props.agent.delegatedToolUses !== undefined
                  ? `${props.agent.delegatedToolUses} ${
                      props.agent.delegatedToolUses === 1 ? "tool" : "tools"
                    }`
                  : "tools —"}
              </span>
            </>
          ) : (
            <span className="shrink-0">{codexState}</span>
          )}
        </span>
      ) : null}
    </span>
  );
}

function AgentRow(props: { agent: ClaudeWorkflowAgent; onSelect: () => void }) {
  const activityLabel = agentActivityLabel(props.agent);
  return (
    <button
      type="button"
      className="group grid w-full grid-cols-[minmax(10rem,1fr)_minmax(15rem,1.35fr)_7.5rem_4.25rem_2.5rem] items-center gap-3 border-t border-white/[0.045] px-3 py-2.5 text-left transition-colors first:border-t-0 hover:bg-white/[0.045]"
      onClick={props.onSelect}
    >
      <span className="flex min-w-0 items-center gap-2">
        <StatusMark status={props.agent.status} />
        <span className="min-w-0">
          <span className="block truncate font-mono text-[11px] text-foreground/85">
            {props.agent.title}
          </span>
          {activityLabel ? (
            <span className="block truncate text-[9px] text-muted-foreground/35">
              {activityLabel}
            </span>
          ) : null}
        </span>
      </span>
      <span className="min-w-0 font-mono text-[10px] text-muted-foreground/55">
        <WorkflowModelAttribution agent={props.agent} />
      </span>
      <AgentUsageSummary agent={props.agent} />
      <span className="text-right font-mono text-[10px] text-muted-foreground/55">
        <ElapsedText
          durationMs={props.agent.durationMs}
          {...(props.agent.status === "running" && props.agent.startedAtMs !== undefined
            ? { startedAt: props.agent.startedAtMs }
            : {})}
        />
      </span>
      <span className="flex items-center justify-end gap-1 text-[9px] text-muted-foreground/30">
        View
        <ChevronRightIcon className="size-3 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground/60" />
      </span>
    </button>
  );
}

function PromptDisclosure(props: {
  provider: "claude" | "openai";
  model: string;
  title: string;
  detail?: string;
  value: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  return (
    <section className="border-b border-white/[0.055] last:border-b-0">
      <button
        type="button"
        className="group flex w-full min-w-0 items-center gap-2 py-2.5 text-left"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <ChevronRightIcon
          className={cn(
            "size-3 shrink-0 text-muted-foreground/35 transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="min-w-0 shrink-0 font-mono text-[10px] text-foreground/75">
          <WorkflowModelLabel model={props.model} provider={props.provider} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/75">
          {props.title}
        </span>
        {props.detail ? (
          <span className="max-w-72 truncate font-mono text-[8px] text-muted-foreground/30">
            {props.detail}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="mb-3 ml-5 max-h-56 overflow-auto border-l border-white/[0.08] pl-3 pr-2">
          <pre className="whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-foreground/65">
            {props.value}
          </pre>
        </div>
      ) : null}
    </section>
  );
}

function DelegationFlow(props: {
  agent: ClaudeWorkflowAgent;
  parentModel?: string | null | undefined;
}) {
  const wrapperModel = formatWorkflowModelName(props.agent.model, "Sonnet");
  const delegatedModel = formatWorkflowModelName(props.agent.delegatedModel, "GPT-5.6-Sol");
  const parentModel = formatWorkflowModelName(props.parentModel, "parent thread");
  const resultReceived = props.agent.delegationState === "result_received";
  const resultRequested = props.agent.delegationState === "requested";

  return (
    <section className="border-b border-white/[0.055] pb-3">
      <p className="mb-2 font-mono text-[8px] uppercase tracking-[0.14em] text-muted-foreground/35">
        Delegation
      </p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px]">
        <span className="font-mono text-foreground/75">
          <WorkflowModelLabel model={wrapperModel} provider="claude" />
        </span>
        <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground/30" />
        <span className="font-mono text-foreground/80">
          <WorkflowModelLabel model={`Call ${delegatedModel}`} provider="openai" />
        </span>
        <span
          className={cn(
            "font-mono text-[8px] uppercase tracking-[0.1em]",
            resultRequested
              ? "text-sky-300/75"
              : resultReceived
                ? "text-emerald-300/70"
                : "text-muted-foreground/35",
          )}
        >
          {resultRequested ? "running" : resultReceived ? "result received" : props.agent.status}
        </span>
        {resultReceived ? (
          <>
            <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground/30" />
            <span className="inline-flex items-center gap-1.5 text-emerald-200/70">
              <CheckIcon className="size-3" />
              Returned to {parentModel}
            </span>
          </>
        ) : null}
      </div>
      <p className="mt-1.5 text-[9px] text-muted-foreground/35">
        {resultRequested
          ? `${wrapperModel} is waiting for the ${delegatedModel} result.`
          : resultReceived
            ? `${delegatedModel} returned through the ${wrapperModel} wrapper to ${parentModel}.`
            : `${wrapperModel} has not recorded a Codex result yet.`}
        {props.agent.delegatedReasoningEffort
          ? ` ${props.agent.delegatedReasoningEffort} reasoning.`
          : ""}
      </p>
    </section>
  );
}

function AgentDetail(props: {
  agent: ClaudeWorkflowAgent;
  parentModel?: string | null | undefined;
  onBack: () => void;
}) {
  const claudeWrapperPrompt = props.agent.claudeWrapperPrompt ?? props.agent.prompt;
  const wrapperModel = formatWorkflowModelName(props.agent.model, "Sonnet");
  const delegatedModel = formatWorkflowModelName(props.agent.delegatedModel, "GPT-5.6-Sol");
  const codexWorkSummary = [
    props.agent.activitySummary,
    props.agent.recentTools.length > 0
      ? `Recorded wrapper tools: ${props.agent.recentTools.join(", ")}.`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");
  const resultMarkdown =
    props.agent.delegatedResultPreview ??
    (props.agent.delegatedProvider ? undefined : props.agent.summary);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <button
          type="button"
          className="rounded-md p-1 text-muted-foreground/55 transition-colors hover:bg-white/[0.06] hover:text-foreground"
          onClick={props.onBack}
          aria-label="Back to agents"
        >
          <ArrowLeftIcon className="size-3.5" />
        </button>
        <StatusMark status={props.agent.status} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground/85">
          {props.agent.title}
        </span>
        <span className="min-w-0 max-w-80 font-mono text-[10px] text-muted-foreground/50">
          <WorkflowModelAttribution agent={props.agent} />
        </span>
        <RunMetrics
          label={formatWorkflowModelName(props.agent.model, "Runner")}
          tokens={props.agent.tokens}
          toolUses={props.agent.toolUses}
          durationMs={props.agent.durationMs}
          {...(props.agent.status === "running" && props.agent.startedAtMs !== undefined
            ? { startedAt: props.agent.startedAtMs }
            : {})}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-3 text-[11px] leading-relaxed">
        {props.agent.delegatedProvider && props.agent.delegatedVia ? (
          <DelegationFlow agent={props.agent} parentModel={props.parentModel} />
        ) : null}
        {claudeWrapperPrompt ? (
          <PromptDisclosure
            provider="claude"
            model={wrapperModel}
            title={`Prompt given to ${wrapperModel}`}
            detail="Exact wrapper packet"
            value={claudeWrapperPrompt}
            defaultOpen
          />
        ) : null}
        {props.agent.delegatedPrompt ? (
          <PromptDisclosure
            provider="openai"
            model={delegatedModel}
            title={`Prompt sent to ${delegatedModel}`}
            detail={props.agent.delegatedVia ?? "Codex MCP call"}
            value={props.agent.delegatedPrompt}
          />
        ) : null}
        {codexWorkSummary ? (
          <PromptDisclosure
            provider="openai"
            model={delegatedModel}
            title="Recorded work"
            detail={`${props.agent.toolUses} wrapper tool${props.agent.toolUses === 1 ? "" : "s"}`}
            value={codexWorkSummary}
          />
        ) : null}
        {props.agent.delegatedProvider ? (
          <section className="pt-3">
            <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-[11px] font-medium text-foreground/80">
                <OpenAI className="size-3.5 shrink-0" />
                GPT‑5.6 result
              </p>
              {props.agent.delegatedThreadId ? (
                <span className="max-w-72 truncate font-mono text-[8px] text-muted-foreground/30">
                  thread · {props.agent.delegatedThreadId}
                </span>
              ) : null}
            </div>
            {resultMarkdown ? (
              <div className="border-l border-emerald-400/30 pl-3 text-foreground/75">
                <ChatMarkdown
                  text={resultMarkdown}
                  cwd={undefined}
                  isStreaming={false}
                  className="text-[11px] leading-relaxed"
                />
              </div>
            ) : props.agent.delegationState === "requested" ? (
              <div className="border-l border-sky-400/30 pl-3">
                <p className="flex items-center gap-2 text-sky-300/70">
                  <LoaderCircleIcon className="size-3.5 animate-spin" />
                  GPT‑5.6 is working. The result will appear here.
                </p>
                <p className="mt-1 text-[9px] text-muted-foreground/30">
                  Codex MCP reports the final result; it does not expose hidden intermediate
                  reasoning.
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground/40">
                The call completed without a readable result preview.
              </p>
            )}
            {resultMarkdown ? (
              <p className="mt-3 flex items-center gap-1.5 text-[9px] text-emerald-200/55">
                <CheckIcon className="size-3" />
                Returned through {wrapperModel} to{" "}
                {formatWorkflowModelName(props.parentModel, "the parent thread")}
              </p>
            ) : null}
          </section>
        ) : props.agent.summary ? (
          <section className="pt-3">
            <ChatMarkdown
              text={props.agent.summary}
              cwd={undefined}
              isStreaming={false}
              className="text-[11px] leading-relaxed text-foreground/75"
            />
          </section>
        ) : !props.agent.prompt &&
          props.agent.recentTools.length === 0 &&
          !props.agent.activitySummary &&
          !props.agent.summary ? (
          <p className="text-muted-foreground/45">Waiting for this agent’s first update…</p>
        ) : null}
      </div>
    </div>
  );
}

function WorkflowRunRow(props: {
  run: ClaudeWorkflowRun;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "w-full border-l-2 px-2.5 py-2 text-left transition-colors",
        props.selected
          ? "border-violet-300/80 bg-white/[0.055]"
          : "border-transparent text-muted-foreground/60 hover:bg-white/[0.035] hover:text-foreground/80",
      )}
      onClick={props.onSelect}
    >
      <span className="flex items-center gap-2">
        <StatusMark status={props.run.status} />
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-foreground/80">
          {props.run.name}
        </span>
      </span>
      <span className="mt-1 block pl-[22px] font-mono text-[9px] text-muted-foreground/40">
        {workflowProgressLabel(props.run.agents)}
      </span>
    </button>
  );
}

function WorkflowDockRow(props: {
  run: ClaudeWorkflowRun;
  expanded: boolean;
  parentModel?: string | null;
  onOpen: () => void;
}) {
  const status = workflowDockStatus(props.run);
  const parentModel = formatWorkflowModelName(
    props.parentModel ?? props.run.agents[0]?.model,
    "Fable",
  );
  return (
    <button
      type="button"
      data-claude-workflow-dock-row="true"
      className="group grid h-8 w-full grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-2.5 border-t border-white/[0.055] px-3 text-left first:border-t-0 transition-colors hover:bg-white/[0.035]"
      onClick={props.onOpen}
      aria-expanded={props.expanded}
      aria-label={`Open workflow ${props.run.name}`}
    >
      <StatusMark status={props.run.status} />
      <GitBranchIcon className="size-3.5 shrink-0 text-violet-300/70" />
      <span className="flex min-w-0 items-center gap-2 overflow-hidden">
        <span className="truncate font-mono text-[10px] text-foreground/85">{props.run.name}</span>
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-[9px]">
          <span className="shrink-0 text-muted-foreground/45">{parentModel}</span>
          <span className="text-muted-foreground/25">·</span>
          <span
            className={cn(
              "shrink-0",
              status.tone === "waiting"
                ? "text-violet-200/75"
                : status.tone === "paused"
                  ? "text-amber-300/70"
                  : status.tone === "failed"
                    ? "text-red-300/70"
                    : status.tone === "finalizing"
                      ? "text-emerald-300/65"
                      : status.tone === "completed"
                        ? "text-emerald-300/65"
                        : "text-sky-300/65",
            )}
          >
            {status.label}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2.5">
        <span className="hidden font-mono text-[9px] text-muted-foreground/40 md:inline">
          {workflowProgressLabel(props.run.agents)}
        </span>
        <span className="font-mono text-[9px] text-muted-foreground/45">
          <ElapsedText
            durationMs={props.run.durationMs}
            {...(props.run.status === "running" ? { startedAt: props.run.startedAt } : {})}
          />
        </span>
        <ChevronDownIcon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/35 transition-transform duration-150 group-hover:text-muted-foreground/65",
            props.expanded && "rotate-180",
          )}
        />
      </span>
    </button>
  );
}

function useWorkflowDelegationToasts(workflows: ReadonlyArray<ClaudeWorkflowRun>) {
  const initializedRef = useRef(false);
  const previousCountsRef = useRef(
    new Map<string, { requested: number; results: number; finalized: number }>(),
  );
  const toastIdsRef = useRef(new Map<string, ReturnType<typeof toastManager.add>>());

  useEffect(() => {
    const nextCounts = new Map<string, ReturnType<typeof delegationCounts>>();

    for (const workflow of workflows) {
      const counts = delegationCounts(workflow.agents);
      nextCounts.set(workflow.id, counts);
      const previous = previousCountsRef.current.get(workflow.id);
      if (!initializedRef.current || counts.requested === 0) continue;

      const changed =
        !previous ||
        counts.requested !== previous.requested ||
        counts.results !== previous.results ||
        counts.finalized !== previous.finalized;
      if (!changed) continue;

      const allFinalized =
        counts.requested > 0 &&
        counts.results === counts.requested &&
        counts.finalized === workflow.agents.length;
      const description =
        counts.results === 0
          ? `${counts.requested} GPT-5.6-Sol worker${counts.requested === 1 ? "" : "s"} requested. Waiting for Codex results.`
          : `${counts.results} of ${counts.requested} Codex results received · ${counts.finalized} of ${workflow.agents.length} agents finalized.`;
      const nextToast = stackedThreadToast({
        type: allFinalized ? "success" : counts.results > 0 ? "info" : "loading",
        title: allFinalized
          ? "Codex workflow finalized"
          : counts.results > 0
            ? "Codex results arriving"
            : "Codex delegation requested",
        description,
        timeout: 0,
        actionProps: {
          children: "View workflow",
          onClick: () => requestClaudeWorkflowNavigatorOpen({ workflowRunId: workflow.id }),
        },
        actionVariant: "outline",
        data: {
          hideCopyButton: true,
          ...(allFinalized ? { dismissAfterVisibleMs: 5_000 } : {}),
        },
      });
      const toastId = toastIdsRef.current.get(workflow.id);
      if (toastId === undefined) {
        toastIdsRef.current.set(workflow.id, toastManager.add(nextToast));
      } else {
        toastManager.update(toastId, nextToast);
      }
    }

    previousCountsRef.current = nextCounts;
    initializedRef.current = true;
  }, [workflows]);

  useEffect(
    () => () => {
      for (const toastId of toastIdsRef.current.values()) toastManager.close(toastId);
      toastIdsRef.current.clear();
    },
    [],
  );
}

function WorkflowPanel(props: {
  workflows: ReadonlyArray<ClaudeWorkflowRun>;
  run: ClaudeWorkflowRun;
  visible: boolean;
  branchLabel: string;
  parentModel?: string | null;
  selectedPhase: ClaudeWorkflowPhase | null;
  selectedAgent: ClaudeWorkflowAgent | null;
  onSelectRun: (run: ClaudeWorkflowRun) => void;
  onSelectPhase: (phase: ClaudeWorkflowPhase) => void;
  onSelectAgent: (agent: ClaudeWorkflowAgent) => void;
  onBackFromAgent: () => void;
  onStop?: () => void;
}) {
  const [workflowListOpen, setWorkflowListOpen] = useState(false);

  return (
    <div
      data-claude-workflow-panel="true"
      className={cn(
        "absolute bottom-full left-1/2 z-30 mb-2 flex h-[min(62vh,520px)] min-h-80 w-[min(96vw,1040px)] -translate-x-1/2 flex-col overflow-hidden rounded-xl bg-[#151515]/98 text-foreground shadow-2xl shadow-black/45 backdrop-blur-xl",
        "origin-bottom transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        props.visible
          ? "translate-y-0 scale-100 opacity-100"
          : "pointer-events-none translate-y-2 scale-[0.985] opacity-0",
      )}
    >
      <header className="flex items-center gap-2.5 border-b border-white/[0.07] px-3 py-1.5">
        <GitBranchIcon className="size-3.5 shrink-0 text-violet-300/80" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-mono text-[11px] font-semibold text-violet-200/90">
            {props.run.name}
          </span>
          <span className="shrink-0 font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground/40">
            {props.run.status}
          </span>
          <span className="min-w-0 truncate border-l border-white/[0.08] pl-2 font-mono text-[8px] text-muted-foreground/45">
            branch · {props.branchLabel}
          </span>
        </div>
        {props.workflows.length > 1 ? (
          <button
            type="button"
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[8px] transition-colors",
              workflowListOpen
                ? "bg-violet-400/10 text-violet-200/75"
                : "text-muted-foreground/45 hover:bg-white/[0.05] hover:text-foreground/75",
            )}
            onClick={() => setWorkflowListOpen((current) => !current)}
            aria-expanded={workflowListOpen}
            aria-controls="claude-workflow-run-list"
            aria-label={`${workflowListOpen ? "Hide" : "Show"} all workflows`}
          >
            <ChevronRightIcon
              className={cn(
                "size-3 transition-transform duration-150",
                workflowListOpen && "rotate-180",
              )}
            />
            {props.workflows.length} workflows
          </button>
        ) : null}
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/55">
          {workflowProgressLabel(props.run.agents)}
        </span>
        <RunMetrics
          label={workflowRunnerModel(props.run.agents, props.parentModel)}
          tokens={props.run.tokens}
          toolUses={props.run.toolUses}
          durationMs={props.run.durationMs}
          {...(props.run.status === "running" ? { startedAt: props.run.startedAt } : {})}
        />
        {props.onStop && (props.run.status === "running" || props.run.status === "paused") ? (
          <button
            type="button"
            className="rounded-md p-1.5 text-muted-foreground/45 transition-colors hover:bg-rose-500/10 hover:text-rose-300"
            onClick={props.onStop}
            aria-label="Stop workflow"
          >
            <SquareIcon className="size-3" />
          </button>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1">
        {props.workflows.length > 1 && workflowListOpen ? (
          <aside
            id="claude-workflow-run-list"
            className="w-48 shrink-0 animate-in border-r border-white/[0.06] py-2 fade-in slide-in-from-left-2 duration-150"
          >
            <p className="mb-1 px-3 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/35">
              Workflows · {props.workflows.length}
            </p>
            <div>
              {props.workflows.map((workflow) => (
                <WorkflowRunRow
                  key={workflow.id}
                  run={workflow}
                  selected={workflow.id === props.run.id}
                  onSelect={() => {
                    props.onSelectRun(workflow);
                    setWorkflowListOpen(false);
                  }}
                />
              ))}
            </div>
          </aside>
        ) : null}
        {props.selectedAgent ? (
          <AgentDetail
            agent={props.selectedAgent}
            parentModel={props.parentModel}
            onBack={props.onBackFromAgent}
          />
        ) : (
          <>
            <aside
              className={cn(
                "shrink-0 border-r border-white/[0.06] p-2 transition-[width] duration-150",
                workflowListOpen ? "w-40 sm:w-48" : "w-48 sm:w-56",
              )}
            >
              <p className="mb-1.5 px-2 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/35">
                Phases
              </p>
              <div className="space-y-0.5">
                {props.run.phases.map((phase, index) => (
                  <PhaseRow
                    key={phase.title}
                    phase={phase}
                    index={index}
                    selected={props.selectedPhase?.title === phase.title}
                    onSelect={() => props.onSelectPhase(phase)}
                  />
                ))}
              </div>
            </aside>
            <main className="min-w-0 flex-1 overflow-y-auto p-2">
              <div className="mb-1.5 flex items-center justify-between gap-3 px-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-[10px] font-semibold text-foreground/75">
                    {props.selectedPhase?.title ?? "Agents"}
                    {props.selectedPhase
                      ? ` · ${workflowProgressLabel(props.selectedPhase.agents)}`
                      : ""}
                  </p>
                  {props.selectedPhase?.detail ? (
                    <p className="mt-0.5 truncate text-[9px] text-muted-foreground/40">
                      {props.selectedPhase.detail}
                    </p>
                  ) : null}
                </div>
                {props.selectedPhase ? (
                  <RunMetrics
                    label={workflowRunnerModel(props.selectedPhase.agents, props.parentModel)}
                    tokens={props.selectedPhase.tokens}
                    toolUses={props.selectedPhase.toolUses}
                    durationMs={props.selectedPhase.durationMs}
                    {...(phaseStartedAt(props.selectedPhase) !== undefined
                      ? { startedAt: phaseStartedAt(props.selectedPhase) }
                      : {})}
                  />
                ) : null}
              </div>
              {props.selectedPhase && props.selectedPhase.agents.length > 0 ? (
                <div>
                  <div className="grid grid-cols-[minmax(10rem,1fr)_minmax(15rem,1.35fr)_7.5rem_4.25rem_2.5rem] gap-3 border-b border-white/[0.06] px-3 pb-2 font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground/35">
                    <span>Agent</span>
                    <span>Model route</span>
                    <span className="text-right">Usage</span>
                    <span className="text-right">Time</span>
                    <span />
                  </div>
                  {props.selectedPhase.agents.map((agent) => (
                    <AgentRow
                      key={agent.id}
                      agent={agent}
                      onSelect={() => props.onSelectAgent(agent)}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex min-h-36 items-center justify-center px-5 text-center text-[11px] text-muted-foreground/40">
                  {props.run.status === "running"
                    ? "Waiting for Claude’s first agent update in this phase…"
                    : "No agent activity was recorded for this phase."}
                </div>
              )}
            </main>
          </>
        )}
      </div>
    </div>
  );
}

export const ClaudeWorkflowNavigator = memo(function ClaudeWorkflowNavigator(props: {
  activities: ReadonlyArray<OrchestrationThreadActivity>;
  branch?: string | null;
  parentModel?: string | null;
  onStopWorkflow?: (taskId: string) => void;
}) {
  const workflows = useMemo(() => deriveClaudeWorkflowRuns(props.activities), [props.activities]);
  useWorkflowDelegationToasts(workflows);
  const activeWorkflows = useMemo(
    () =>
      workflows.filter(
        (workflow) =>
          workflow.status === "pending" ||
          workflow.status === "running" ||
          workflow.status === "paused",
      ),
    [workflows],
  );
  const navigatorRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const [panelVisible, setPanelVisible] = useState(false);
  const [runIndex, setRunIndex] = useState(0);
  const [selectedPhaseTitle, setSelectedPhaseTitle] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const run = workflows[Math.min(runIndex, Math.max(0, workflows.length - 1))] ?? null;
  const selectedPhase =
    run?.phases.find((phase) => phase.title === selectedPhaseTitle) ?? run?.phases[0] ?? null;
  const selectedAgent = run?.agents.find((agent) => agent.id === selectedAgentId) ?? null;

  useEffect(() => {
    if (runIndex >= workflows.length) setRunIndex(Math.max(0, workflows.length - 1));
  }, [runIndex, workflows.length]);

  useEffect(() => {
    setSelectedPhaseTitle(null);
    setSelectedAgentId(null);
  }, [run?.id]);

  const openActiveWorkflow = useCallback(
    (target: { workflowRunId?: string; agentId?: string } = {}) => {
      const targetedRunIndex = target.workflowRunId
        ? workflows.findIndex((workflow) => workflow.id === target.workflowRunId)
        : -1;
      const nextRunIndex =
        targetedRunIndex >= 0
          ? targetedRunIndex
          : (findActiveClaudeWorkflowRunIndex(workflows) ?? (workflows.length > 0 ? 0 : null));
      if (nextRunIndex !== null) {
        setRunIndex(nextRunIndex);
        const nextRun = workflows[nextRunIndex];
        const nextAgent = target.agentId
          ? nextRun?.agents.find((agent) => agent.id === target.agentId)
          : undefined;
        setSelectedAgentId(nextAgent?.id ?? null);
        setSelectedPhaseTitle(nextAgent?.phase ?? null);
      }
      setExpanded(true);
    },
    [workflows],
  );

  useEffect(() => onClaudeWorkflowNavigatorOpen(openActiveWorkflow), [openActiveWorkflow]);

  useEffect(() => {
    let frame: number | undefined;
    let timer: number | undefined;

    if (expanded) {
      setPanelMounted(true);
      frame = window.requestAnimationFrame(() => setPanelVisible(true));
    } else {
      setPanelVisible(false);
      timer = window.setTimeout(() => setPanelMounted(false), 200);
    }

    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const navigator = navigatorRef.current;
      if (navigator && !event.composedPath().includes(navigator)) {
        setExpanded(false);
      }
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
  }, [expanded]);

  if (!run || (!expanded && !panelMounted && activeWorkflows.length === 0)) return null;
  const dockWorkflows = activeWorkflows.length > 0 ? activeWorkflows : [run];

  return (
    <div
      ref={navigatorRef}
      className="pointer-events-auto relative z-0 mx-auto w-full max-w-3xl px-4 after:pointer-events-none after:absolute after:inset-x-4 after:top-full after:h-3 after:bg-[#1a1a1a]/96 after:content-['']"
    >
      {panelMounted ? (
        <WorkflowPanel
          workflows={workflows}
          run={run}
          visible={panelVisible}
          branchLabel={props.branch?.trim() || "current checkout"}
          {...(props.parentModel !== undefined ? { parentModel: props.parentModel } : {})}
          selectedPhase={selectedPhase}
          selectedAgent={selectedAgent}
          onSelectRun={(nextRun) => {
            const nextIndex = workflows.findIndex((workflow) => workflow.id === nextRun.id);
            if (nextIndex >= 0) setRunIndex(nextIndex);
          }}
          onSelectPhase={(phase) => {
            setSelectedPhaseTitle(phase.title);
            setSelectedAgentId(null);
          }}
          onSelectAgent={(agent) => setSelectedAgentId(agent.id)}
          onBackFromAgent={() => setSelectedAgentId(null)}
          {...(props.onStopWorkflow ? { onStop: () => props.onStopWorkflow?.(run.taskId) } : {})}
        />
      ) : null}

      <div
        data-claude-workflow-navigator="true"
        className="relative z-0 overflow-hidden rounded-t-xl bg-[#1a1a1a]/96 shadow-lg shadow-black/20 backdrop-blur-md"
      >
        {dockWorkflows.map((workflow) => (
          <WorkflowDockRow
            key={workflow.id}
            run={workflow}
            expanded={expanded && workflow.id === run.id}
            {...(props.parentModel !== undefined ? { parentModel: props.parentModel } : {})}
            onOpen={() => {
              if (expanded && workflow.id === run.id) {
                setExpanded(false);
                return;
              }
              openActiveWorkflow({ workflowRunId: workflow.id });
            }}
          />
        ))}
      </div>
    </div>
  );
});

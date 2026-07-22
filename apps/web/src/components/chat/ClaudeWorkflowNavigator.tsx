import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
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
  inferClaudeWorkflowModelProvider,
  type ClaudeWorkflowAgent,
  type ClaudeWorkflowPhase,
  type ClaudeWorkflowRun,
  type ClaudeWorkflowStatus,
} from "../../claude-workflows";
import { onClaudeWorkflowNavigatorOpen } from "../../claudeWorkflowNavigatorBus";
import { ClaudeAI, OpenAI } from "../Icons";
import { cn } from "~/lib/utils";

function compactNumber(value: number): string {
  if (value < 1_000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}

function elapsedLabel(durationMs: number, startedAt?: string): string {
  const derivedDuration = startedAt ? Math.max(0, Date.now() - Date.parse(startedAt)) : 0;
  const seconds = Math.floor(Math.max(durationMs, derivedDuration) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
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
  tokens: number;
  toolUses: number;
  durationMs: number;
  startedAt?: string;
}) {
  return (
    <span className="flex shrink-0 items-center gap-2 font-mono text-[10px] text-muted-foreground/55">
      {props.tokens > 0 ? <span>{compactNumber(props.tokens)} tok</span> : null}
      {props.toolUses > 0 ? (
        <span className="inline-flex items-center gap-1">
          <WrenchIcon className="size-2.5" /> {props.toolUses}
        </span>
      ) : null}
      <span className="inline-flex items-center gap-1">
        <Clock3Icon className="size-2.5" />
        {elapsedLabel(props.durationMs, props.startedAt)}
      </span>
    </span>
  );
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
        {props.phase.agents.filter((agent) => agent.status === "completed").length}/
        {props.phase.agents.length}
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
      <span className="truncate">{props.model}</span>
    </span>
  );
}

function WorkflowModelAttribution(props: { agent: ClaudeWorkflowAgent }) {
  const wrapperModel = props.agent.model ?? "Claude wrapper";
  const delegatedModel = props.agent.delegatedModel ?? "Codex · model not reported";
  const hasVerifiedDelegation = Boolean(props.agent.delegatedProvider && props.agent.delegatedVia);
  const title = hasVerifiedDelegation
    ? `Runner: ${wrapperModel}. Delegated via ${props.agent.delegatedVia}: ${delegatedModel}${props.agent.delegatedReasoningEffort ? ` (${props.agent.delegatedReasoningEffort} reasoning)` : ""}.`
    : `Runner: ${wrapperModel}.`;

  return (
    <span className="flex min-w-0 items-center gap-1.5" title={title}>
      <WorkflowModelLabel model={wrapperModel} provider="claude" />
      {hasVerifiedDelegation ? (
        <>
          <ArrowRightIcon className="size-2.5 shrink-0 text-muted-foreground/30" />
          <WorkflowModelLabel
            model={delegatedModel}
            provider={props.agent.delegatedProvider ?? null}
          />
        </>
      ) : null}
    </span>
  );
}

function AgentRow(props: { agent: ClaudeWorkflowAgent; onSelect: () => void }) {
  return (
    <button
      type="button"
      className="group grid w-full grid-cols-[minmax(0,1fr)_minmax(12rem,1fr)_4.5rem_3.5rem_4rem_3rem] items-center gap-3 border-t border-white/[0.045] px-2 py-2 text-left transition-colors first:border-t-0 hover:bg-white/[0.045]"
      onClick={props.onSelect}
    >
      <span className="flex min-w-0 items-center gap-2">
        <StatusMark status={props.agent.status} />
        <span className="min-w-0">
          <span className="block truncate font-mono text-[11px] text-foreground/85">
            {props.agent.title}
          </span>
          {props.agent.lastToolName ? (
            <span className="block truncate text-[9px] text-muted-foreground/35">
              current tool · {props.agent.lastToolName}
            </span>
          ) : null}
        </span>
      </span>
      <span className="min-w-0 font-mono text-[10px] text-muted-foreground/55">
        <WorkflowModelAttribution agent={props.agent} />
      </span>
      <span className="text-right font-mono text-[10px] text-muted-foreground/55">
        {compactNumber(props.agent.tokens)}
      </span>
      <span className="text-right font-mono text-[10px] text-muted-foreground/55">
        {props.agent.toolUses}
      </span>
      <span className="text-right font-mono text-[10px] text-muted-foreground/55">
        {elapsedLabel(props.agent.durationMs)}
      </span>
      <span className="flex items-center justify-end gap-1 text-[9px] text-muted-foreground/30">
        View
        <ChevronRightIcon className="size-3 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground/60" />
      </span>
    </button>
  );
}

function AgentDetail(props: { agent: ClaudeWorkflowAgent; onBack: () => void }) {
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
          tokens={props.agent.tokens}
          toolUses={props.agent.toolUses}
          durationMs={props.agent.durationMs}
        />
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-[11px] leading-relaxed">
        {props.agent.prompt ? (
          <section>
            <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/40">
              Prompt
            </p>
            <p className="whitespace-pre-wrap text-foreground/70">{props.agent.prompt}</p>
          </section>
        ) : null}
        {props.agent.delegatedProvider && props.agent.delegatedVia ? (
          <section>
            <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/40">
              Execution provenance
            </p>
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-foreground/70">
              <WorkflowModelLabel model={props.agent.model ?? "Claude wrapper"} provider="claude" />
              <ArrowRightIcon className="size-2.5 text-muted-foreground/35" />
              <WorkflowModelLabel
                model={props.agent.delegatedModel ?? "Codex · model not reported"}
                provider={props.agent.delegatedProvider ?? null}
              />
              {props.agent.delegatedReasoningEffort ? (
                <span className="text-muted-foreground/45">
                  · {props.agent.delegatedReasoningEffort} reasoning
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-[9px] text-muted-foreground/35">
              Verified from the {props.agent.delegatedVia} tool call recorded in this agent’s
              transcript.
            </p>
          </section>
        ) : null}
        {props.agent.recentTools.length > 0 ? (
          <section>
            <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/40">
              Recent tools · {props.agent.toolUses} calls
            </p>
            <div className="space-y-1">
              {props.agent.recentTools.map((toolName) => (
                <p
                  key={toolName}
                  className="flex items-center gap-1.5 font-mono text-foreground/70"
                >
                  <WrenchIcon className="size-3 text-sky-400/70" />
                  {toolName}
                </p>
              ))}
            </div>
          </section>
        ) : null}
        {props.agent.summary ? (
          <section>
            <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/40">
              Result
            </p>
            <p className="whitespace-pre-wrap text-foreground/70">{props.agent.summary}</p>
          </section>
        ) : null}
        {!props.agent.prompt && props.agent.recentTools.length === 0 && !props.agent.summary ? (
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
  const completed = props.run.agents.filter((agent) => agent.status === "completed").length;
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
        {completed}/{props.run.agents.length} complete
      </span>
    </button>
  );
}

function WorkflowPanel(props: {
  workflows: ReadonlyArray<ClaudeWorkflowRun>;
  run: ClaudeWorkflowRun;
  branchLabel: string;
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
      className="absolute bottom-full left-1/2 z-30 mb-2 flex h-[min(62vh,520px)] min-h-80 w-[min(96vw,1040px)] -translate-x-1/2 animate-in flex-col overflow-hidden rounded-xl border border-white/[0.09] bg-[#151515]/98 text-foreground shadow-2xl shadow-black/45 backdrop-blur-xl fade-in slide-in-from-bottom-2 duration-150"
    >
      <header className="flex items-start gap-3 border-b border-white/[0.07] px-3 py-2.5">
        <GitBranchIcon className="mt-0.5 size-4 shrink-0 text-violet-300/80" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-[12px] font-semibold text-violet-200/90">
              {props.run.name}
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/40">
              {props.run.status}
            </span>
            <span className="truncate border-l border-white/[0.08] pl-2 font-mono text-[9px] text-muted-foreground/45">
              branch · {props.branchLabel}
            </span>
          </div>
          {props.run.summary ? (
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground/50">
              {props.run.summary}
            </p>
          ) : null}
        </div>
        {props.workflows.length > 1 ? (
          <button
            type="button"
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[9px] transition-colors",
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
          {props.run.agents.filter((agent) => agent.status === "completed").length}/
          {props.run.agents.length} complete
        </span>
        <RunMetrics
          tokens={props.run.tokens}
          toolUses={props.run.toolUses}
          durationMs={props.run.durationMs}
          {...(props.run.status === "running" || props.run.status === "paused"
            ? { startedAt: props.run.startedAt }
            : {})}
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
          <AgentDetail agent={props.selectedAgent} onBack={props.onBackFromAgent} />
        ) : (
          <>
            <aside
              className={cn(
                "shrink-0 border-r border-white/[0.06] p-2 transition-[width] duration-150",
                workflowListOpen ? "w-44 sm:w-52" : "w-52 sm:w-64",
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
                      ? ` · ${props.selectedPhase.agents.filter((agent) => agent.status === "completed").length}/${props.selectedPhase.agents.length} complete`
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
                    tokens={props.selectedPhase.tokens}
                    toolUses={props.selectedPhase.toolUses}
                    durationMs={props.selectedPhase.durationMs}
                  />
                ) : null}
              </div>
              {props.selectedPhase && props.selectedPhase.agents.length > 0 ? (
                <div>
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(12rem,1fr)_4.5rem_3.5rem_4rem_3rem] gap-3 border-b border-white/[0.06] px-2 pb-1.5 font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground/30">
                    <span>Agent</span>
                    <span>Model</span>
                    <span className="text-right">Tokens</span>
                    <span className="text-right">Tools</span>
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
  onStopWorkflow?: (taskId: string) => void;
}) {
  const workflows = useMemo(() => deriveClaudeWorkflowRuns(props.activities), [props.activities]);
  const navigatorRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
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

  const openActiveWorkflow = useCallback(() => {
    const activeRunIndex = findActiveClaudeWorkflowRunIndex(workflows);
    if (activeRunIndex !== null) setRunIndex(activeRunIndex);
    setExpanded(true);
  }, [workflows]);

  useEffect(() => onClaudeWorkflowNavigatorOpen(openActiveWorkflow), [openActiveWorkflow]);

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

  if (!run) return null;

  const cycleRun = (direction: -1 | 1) => {
    setRunIndex((current) => (current + direction + workflows.length) % workflows.length);
  };

  return (
    <div
      ref={navigatorRef}
      className="pointer-events-auto relative mx-auto mt-1.5 w-full max-w-3xl px-1"
    >
      {expanded ? (
        <WorkflowPanel
          workflows={workflows}
          run={run}
          branchLabel={props.branch?.trim() || "current checkout"}
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
        className="flex h-9 items-center gap-2 rounded-xl border border-white/[0.07] bg-[#171717]/92 px-2.5 shadow-lg shadow-black/15 backdrop-blur-md"
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => {
            if (expanded) setExpanded(false);
            else openActiveWorkflow();
          }}
          aria-expanded={expanded}
        >
          <StatusMark status={run.status} />
          <GitBranchIcon className="size-3.5 shrink-0 text-violet-300/70" />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/75">
            {run.name}
          </span>
          <span className="hidden font-mono text-[9px] text-muted-foreground/40 sm:inline">
            {run.agents.filter((agent) => agent.status === "completed").length}/{run.agents.length}{" "}
            agents
          </span>
          <RunMetrics
            tokens={run.tokens}
            toolUses={run.toolUses}
            durationMs={run.durationMs}
            {...(run.status === "running" || run.status === "paused"
              ? { startedAt: run.startedAt }
              : {})}
          />
          <ChevronDownIcon
            className={cn(
              "size-3.5 text-muted-foreground/45 transition-transform duration-150",
              expanded && "rotate-180",
            )}
          />
        </button>
        {workflows.length > 1 ? (
          <div className="flex items-center border-l border-white/[0.07] pl-1">
            <button
              type="button"
              className="rounded p-1 text-muted-foreground/40 transition-colors hover:bg-white/[0.05] hover:text-foreground/80"
              onClick={() => cycleRun(-1)}
              aria-label="Previous workflow"
            >
              <ChevronLeftIcon className="size-3" />
            </button>
            <span className="w-7 text-center font-mono text-[9px] text-muted-foreground/35">
              {runIndex + 1}/{workflows.length}
            </span>
            <button
              type="button"
              className="rounded p-1 text-muted-foreground/40 transition-colors hover:bg-white/[0.05] hover:text-foreground/80"
              onClick={() => cycleRun(1)}
              aria-label="Next workflow"
            >
              <ChevronRightIcon className="size-3" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
});

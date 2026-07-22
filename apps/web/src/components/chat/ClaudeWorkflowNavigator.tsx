import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import {
  ArrowLeftIcon,
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
import { memo, useEffect, useMemo, useState } from "react";
import {
  deriveClaudeWorkflowRuns,
  type ClaudeWorkflowAgent,
  type ClaudeWorkflowPhase,
  type ClaudeWorkflowRun,
  type ClaudeWorkflowStatus,
} from "../../claude-workflows";
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

function AgentRow(props: { agent: ClaudeWorkflowAgent; onSelect: () => void }) {
  return (
    <button
      type="button"
      className="group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/[0.05]"
      onClick={props.onSelect}
    >
      <StatusMark status={props.agent.status} />
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/80">
        {props.agent.title}
      </span>
      {props.agent.subagentType ? (
        <span className="hidden max-w-28 truncate text-[10px] text-muted-foreground/45 sm:block">
          {props.agent.subagentType}
        </span>
      ) : null}
      <RunMetrics
        tokens={props.agent.tokens}
        toolUses={props.agent.toolUses}
        durationMs={props.agent.durationMs}
      />
      <ChevronRightIcon className="size-3 text-muted-foreground/25 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground/60" />
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
        {props.agent.lastToolName ? (
          <section>
            <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/40">
              Recent tool
            </p>
            <p className="inline-flex items-center gap-1.5 font-mono text-foreground/70">
              <WrenchIcon className="size-3 text-sky-400/70" /> {props.agent.lastToolName}
            </p>
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
        {!props.agent.prompt && !props.agent.lastToolName && !props.agent.summary ? (
          <p className="text-muted-foreground/45">Waiting for this agent’s first update…</p>
        ) : null}
      </div>
    </div>
  );
}

function WorkflowPanel(props: {
  run: ClaudeWorkflowRun;
  selectedPhase: ClaudeWorkflowPhase | null;
  selectedAgent: ClaudeWorkflowAgent | null;
  onSelectPhase: (phase: ClaudeWorkflowPhase) => void;
  onSelectAgent: (agent: ClaudeWorkflowAgent) => void;
  onBackFromAgent: () => void;
  onStop?: () => void;
}) {
  return (
    <div
      data-claude-workflow-panel="true"
      className="absolute inset-x-0 bottom-full z-30 mb-2 flex h-[min(55vh,430px)] min-h-64 animate-in flex-col overflow-hidden rounded-xl border border-white/[0.09] bg-[#151515]/98 text-foreground shadow-2xl shadow-black/45 backdrop-blur-xl fade-in slide-in-from-bottom-2 duration-150"
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
          </div>
          {props.run.summary ? (
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground/50">
              {props.run.summary}
            </p>
          ) : null}
        </div>
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
        {props.selectedAgent ? (
          <AgentDetail agent={props.selectedAgent} onBack={props.onBackFromAgent} />
        ) : (
          <>
            <aside className="w-44 shrink-0 border-r border-white/[0.06] p-2 sm:w-52">
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
                    {props.selectedPhase ? ` · ${props.selectedPhase.agents.length} agents` : ""}
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
                <div className="space-y-0.5">
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
  onStopWorkflow?: (taskId: string) => void;
}) {
  const workflows = useMemo(() => deriveClaudeWorkflowRuns(props.activities), [props.activities]);
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

  if (!run) return null;

  const cycleRun = (direction: -1 | 1) => {
    setRunIndex((current) => (current + direction + workflows.length) % workflows.length);
  };

  return (
    <div className="pointer-events-auto relative mx-auto mt-1.5 w-full max-w-3xl px-1">
      {expanded ? (
        <WorkflowPanel
          run={run}
          selectedPhase={selectedPhase}
          selectedAgent={selectedAgent}
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
          onClick={() => setExpanded((current) => !current)}
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

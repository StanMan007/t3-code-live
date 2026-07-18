import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { ArrowUpIcon, MicIcon, SquareIcon, WavesIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ChatMessage } from "../../types";
import { cn } from "~/lib/utils";
import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";
import { realtimeEnvironment } from "~/state/realtime";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  buildLiveThreadPrompt,
  hasExplicitLiveThreadDispatchIntent,
  readLiveThreadContext,
} from "./liveThreadContext";
import { parseLiveThreadDataMessage } from "./liveThreadEvents";

type LiveThreadPhase =
  | "idle"
  | "requesting"
  | "connecting"
  | "listening"
  | "sent"
  | "stopping"
  | "error";

export const LIVE_THREAD_PANEL_PORTAL_ID = "t3-live-thread-panel";

function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      peer.removeEventListener("icegatheringstatechange", onChange);
      reject(new Error("Timed out gathering WebRTC connection candidates."));
    }, 10_000);
    const onChange = () => {
      if (peer.iceGatheringState !== "complete") return;
      window.clearTimeout(timeout);
      peer.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    peer.addEventListener("icegatheringstatechange", onChange);
  });
}

function sendToolOutput(channel: RTCDataChannel, callId: string, output: unknown): void {
  channel.send(
    JSON.stringify({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) },
    }),
  );
  channel.send(JSON.stringify({ type: "response.create" }));
}

export function LiveThreadControl(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly threadId: ThreadId | null;
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly enabled: boolean;
  readonly onDispatch: (instruction: string) => void;
}) {
  const startRealtime = useAtomCommand(realtimeEnvironment.start, { reportFailure: false });
  const liveThreadSurfaceActive = useRightPanelStore((state) => {
    const panel = selectThreadRightPanelState(state.byThreadKey, props.threadRef);
    return panel.isOpen && panel.activeSurfaceId === "live-thread";
  });
  const liveThreadSurfacePresent = useRightPanelStore((state) => {
    const panel = selectThreadRightPanelState(state.byThreadKey, props.threadRef);
    return panel.surfaces.some((surface) => surface.kind === "live-thread");
  });
  const [phase, setPhase] = useState<LiveThreadPhase>("idle");
  const [transcript, setTranscript] = useState("");
  const [handoff, setHandoff] = useState("");
  const [contextReads, setContextReads] = useState(0);
  const [error, setError] = useState("");
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const mediaRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeRef = useRef(false);
  const dispatchedRef = useRef(false);
  const messagesRef = useRef(props.messages);
  const handledToolCallIdsRef = useRef(new Set<string>());
  const latestUserTranscriptRef = useRef("");
  const knownMessageIdsRef = useRef(new Set<string>());
  const spokenMessageIdsRef = useRef(new Set<string>());
  const surfaceWasPresentRef = useRef(liveThreadSurfacePresent);

  const openSurface = useCallback(() => {
    useRightPanelStore.getState().open(props.threadRef, "live-thread");
  }, [props.threadRef]);

  const releaseBrowserMedia = useCallback(() => {
    channelRef.current?.close();
    channelRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    for (const track of mediaRef.current?.getTracks() ?? []) track.stop();
    mediaRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    activeRef.current = false;
  }, []);

  const stop = useCallback(async () => {
    setPhase("stopping");
    releaseBrowserMedia();
    dispatchedRef.current = false;
    setTranscript("");
    setHandoff("");
    setContextReads(0);
    setError("");
    setPhase("idle");
  }, [releaseBrowserMedia]);

  const start = useCallback(async () => {
    const threadId = props.threadId;
    if (!threadId || !props.enabled) return;
    setError("");
    setTranscript("");
    setHandoff("");
    setContextReads(0);
    setPhase("requesting");
    dispatchedRef.current = false;
    knownMessageIdsRef.current = new Set(props.messages.map((message) => message.id));
    spokenMessageIdsRef.current = new Set();
    handledToolCallIdsRef.current = new Set();
    latestUserTranscriptRef.current = "";

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      mediaRef.current = media;
      const peer = new RTCPeerConnection();
      peerRef.current = peer;
      activeRef.current = true;
      for (const track of media.getAudioTracks()) peer.addTrack(track, media);

      peer.ontrack = (event) => {
        if (audioRef.current) audioRef.current.srcObject = event.streams[0] ?? null;
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
          setError("The realtime audio connection was interrupted.");
          setPhase("error");
        }
      };

      const channel = peer.createDataChannel("oai-events");
      channelRef.current = channel;
      channel.addEventListener("open", () => setPhase("listening"));
      channel.addEventListener("error", () => {
        setError("The realtime event channel failed.");
        setPhase("error");
      });
      channel.addEventListener("message", (message) => {
        const event = parseLiveThreadDataMessage(message.data);
        if (event.type === "transcript.delta") {
          setTranscript((current) => `${current}${event.text}`.slice(-600));
        } else if (event.type === "transcript.done") {
          setTranscript(event.text.slice(-600));
          if (event.role === "user") latestUserTranscriptRef.current = event.text;
        } else if (event.type === "context.request") {
          if (handledToolCallIdsRef.current.has(event.callId)) return;
          handledToolCallIdsRef.current.add(event.callId);
          const result = readLiveThreadContext(messagesRef.current, {
            scope: event.scope,
            ...(event.query ? { query: event.query } : {}),
            ...(event.cursor === undefined ? {} : { cursor: event.cursor }),
          });
          sendToolOutput(channel, event.callId, result);
          setContextReads((count) => count + 1);
        } else if (event.type === "handoff") {
          setHandoff(event.text);
          if (event.callId && channel.readyState === "open") {
            if (handledToolCallIdsRef.current.has(event.callId)) return;
            handledToolCallIdsRef.current.add(event.callId);
            if (!hasExplicitLiveThreadDispatchIntent(latestUserTranscriptRef.current)) {
              sendToolOutput(channel, event.callId, {
                dispatched: false,
                requires_user_confirmation: true,
                reason:
                  "No explicit send or dispatch instruction was found in the latest user transcript.",
              });
              return;
            }
            knownMessageIdsRef.current = new Set(messagesRef.current.map((message) => message.id));
            dispatchedRef.current = true;
            latestUserTranscriptRef.current = "";
            props.onDispatch(event.text);
            setPhase("sent");
            sendToolOutput(channel, event.callId, {
              dispatched: true,
              exactly_once: true,
            });
          }
        } else if (event.type === "error") {
          setError(event.message);
          setPhase("error");
        }
      });

      setPhase("connecting");
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIceGathering(peer);
      const sdp = peer.localDescription?.sdp;
      if (!sdp) throw new Error("The browser did not produce a WebRTC offer.");
      const result = await startRealtime({
        environmentId: props.environmentId,
        input: { threadId, sdp, prompt: buildLiveThreadPrompt(props.messages) },
      });
      if (!AsyncResult.isSuccess(result)) {
        const failure = AsyncResult.isFailure(result) ? Cause.squash(result.cause) : undefined;
        throw new Error(
          failure instanceof Error
            ? failure.message
            : failure === undefined
              ? "The realtime session did not start."
              : String(failure),
        );
      }
      await peer.setRemoteDescription({ type: "answer", sdp: result.value.sdp });
    } catch (cause) {
      releaseBrowserMedia();
      setError(cause instanceof Error ? cause.message : "Could not start Live Thread.");
      setPhase("error");
    }
  }, [
    props.enabled,
    props.environmentId,
    props.messages,
    props.onDispatch,
    props.threadId,
    releaseBrowserMedia,
    startRealtime,
  ]);

  const dispatch = useCallback(() => {
    const instruction = handoff.trim();
    if (!instruction) return;
    knownMessageIdsRef.current = new Set(props.messages.map((message) => message.id));
    dispatchedRef.current = true;
    props.onDispatch(instruction);
    setPhase("sent");
  }, [handoff, props.messages, props.onDispatch]);

  useEffect(() => {
    messagesRef.current = props.messages;
  }, [props.messages]);

  useEffect(() => {
    if (!activeRef.current || !dispatchedRef.current || !props.threadId) return;
    const message = [...props.messages]
      .toReversed()
      .find(
        (candidate) =>
          candidate.role === "assistant" &&
          !candidate.streaming &&
          candidate.text.trim().length > 0 &&
          !knownMessageIdsRef.current.has(candidate.id) &&
          !spokenMessageIdsRef.current.has(candidate.id),
      );
    if (!message) return;
    spokenMessageIdsRef.current.add(message.id);
    const channel = channelRef.current;
    if (!channel || channel.readyState !== "open") return;
    channel.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Codex completed the dispatched task. Summarize this result aloud in at most three sentences, then ask what to do next: ${message.text}`,
            },
          ],
        },
      }),
    );
    channel.send(JSON.stringify({ type: "response.create" }));
  }, [props.messages, props.threadId]);

  useEffect(
    () => () => {
      releaseBrowserMedia();
    },
    [releaseBrowserMedia],
  );

  useEffect(() => {
    if (surfaceWasPresentRef.current && !liveThreadSurfacePresent && activeRef.current) {
      void stop();
    }
    surfaceWasPresentRef.current = liveThreadSurfacePresent;
  }, [liveThreadSurfacePresent, stop]);

  useLayoutEffect(() => {
    setPortalTarget(
      liveThreadSurfaceActive ? document.getElementById(LIVE_THREAD_PANEL_PORTAL_ID) : null,
    );
  }, [liveThreadSurfaceActive]);

  const active = phase !== "idle" && phase !== "error";
  const status =
    phase === "requesting"
      ? "Waiting for microphone"
      : phase === "connecting"
        ? "Connecting"
        : phase === "listening"
          ? "Listening"
          : phase === "sent"
            ? "Sent to Codex"
            : phase === "stopping"
              ? "Stopping"
              : phase === "error"
                ? "Needs attention"
                : phase === "idle"
                  ? "Ready"
                  : "Needs attention";

  const panel = (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-8 sm:px-8">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <WavesIcon className={cn("size-4", phase === "listening" && "text-emerald-400")} />
              <h2 className="text-sm font-medium text-foreground">Live Thread</h2>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Talk through the current task. Codex only sends a follow-up after explicit approval.
            </p>
          </div>
          {phase !== "idle" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void stop()}
              disabled={phase === "stopping"}
            >
              <SquareIcon className="size-3" />
              End
            </Button>
          ) : null}
        </div>

        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <div className="relative flex size-40 items-center justify-center" aria-hidden>
            <div
              className={cn(
                "absolute size-40 rounded-full border border-border/50 transition-all duration-700",
                phase === "listening" && "scale-105 border-emerald-400/30",
              )}
            />
            <div
              className={cn(
                "absolute size-28 rounded-full border border-border/70 bg-muted/20 transition-all duration-500",
                phase === "listening" && "animate-pulse border-emerald-400/40 bg-emerald-400/5",
                phase === "error" && "border-red-400/40 bg-red-400/5",
              )}
            />
            <div
              className={cn(
                "relative flex size-16 items-center justify-center rounded-full bg-foreground text-background shadow-lg transition-all duration-300",
                phase === "listening" && "scale-105 bg-emerald-400 text-emerald-950",
                phase === "error" && "bg-red-400 text-red-950",
              )}
            >
              <WavesIcon className="size-6" />
            </div>
          </div>

          <p className="mt-6 text-base font-medium text-foreground">{status}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {contextReads > 0
              ? `${contextReads} task context read${contextReads === 1 ? "" : "s"}`
              : "Task messages available on request"}
          </p>

          {error ? <p className="mt-5 max-w-md text-sm leading-6 text-red-400">{error}</p> : null}
          {transcript && !handoff ? (
            <p className="mt-6 max-w-lg text-pretty text-lg leading-8 text-foreground/90">
              {transcript}
            </p>
          ) : null}

          {phase === "idle" || phase === "error" ? (
            <Button type="button" size="sm" className="mt-6" onClick={() => void start()}>
              <MicIcon className="size-4" />
              {phase === "error" ? "Try again" : "Start talking"}
            </Button>
          ) : null}
        </div>

        <div className="border-t border-border/70 pt-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
            <span>Task context</span>
            <span>Explicit follow-ups only</span>
            <span>Microphone stays local until connected</span>
          </div>
          {handoff ? (
            <div className="mt-5 border-t border-border/70 pt-5">
              {phase === "sent" ? (
                <div>
                  <p className="text-[11px] text-muted-foreground">Sent request</p>
                  <p className="mt-2 text-sm leading-6 text-foreground/90">{handoff}</p>
                </div>
              ) : (
                <div>
                  <label className="text-xs text-muted-foreground" htmlFor="live-thread-handoff">
                    Review follow-up
                  </label>
                  <textarea
                    id="live-thread-handoff"
                    value={handoff}
                    onChange={(event) => setHandoff(event.target.value)}
                    className="mt-2 min-h-32 w-full resize-y rounded-md border border-border bg-background p-3 text-sm leading-6 text-foreground outline-none focus:border-ring"
                  />
                  <div className="mt-3 flex justify-end">
                    <Button type="button" size="sm" onClick={dispatch}>
                      <ArrowUpIcon className="size-3.5" />
                      Send to Codex
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="relative flex shrink-0 items-center">
        <audio ref={audioRef} autoPlay className="hidden" />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant={active || liveThreadSurfaceActive ? "secondary" : "ghost"}
                size="icon-sm"
                disabled={
                  !props.enabled ||
                  phase === "requesting" ||
                  phase === "connecting" ||
                  phase === "stopping"
                }
                onClick={() => {
                  openSurface();
                  if (phase === "idle") void start();
                }}
                aria-label="Open Live Thread"
                className={cn(active && "text-emerald-400")}
              >
                {active ? <WavesIcon className="size-4" /> : <MicIcon className="size-4" />}
              </Button>
            }
          />
          <TooltipPopup side="top">
            {props.enabled
              ? active
                ? "Open Live Thread"
                : "Talk through this task"
              : "Live Thread requires an active Codex task"}
          </TooltipPopup>
        </Tooltip>
      </div>
      {portalTarget ? createPortal(panel, portalTarget) : null}
    </>
  );
}

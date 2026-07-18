import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { ArrowUpIcon, MicIcon, SquareIcon, WavesIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ChatMessage } from "../../types";
import { cn } from "~/lib/utils";
import { realtimeEnvironment } from "~/state/realtime";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { parseLiveThreadDataMessage } from "./liveThreadEvents";

function buildLiveThreadPrompt(messages: ReadonlyArray<ChatMessage>): string {
  const snapshot = messages
    .filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") && message.text.trim().length > 0,
    )
    .slice(-10)
    .map((message) => `${message.role === "user" ? "User" : "Codex"}: ${message.text.trim()}`)
    .join("\n")
    .slice(-7_000);
  return [
    "Discuss the current task naturally and help the user reason through it.",
    "Treat this bounded task snapshot as authoritative; if a detail is absent, say so.",
    snapshot ? `Current task snapshot:\n${snapshot}` : "The task has no message snapshot yet.",
  ].join("\n\n");
}

type LiveThreadPhase =
  | "idle"
  | "requesting"
  | "connecting"
  | "listening"
  | "sent"
  | "stopping"
  | "error";

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

export function LiveThreadControl(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly enabled: boolean;
  readonly onDispatch: (instruction: string) => void;
}) {
  const startRealtime = useAtomCommand(realtimeEnvironment.start, { reportFailure: false });
  const [phase, setPhase] = useState<LiveThreadPhase>("idle");
  const [transcript, setTranscript] = useState("");
  const [handoff, setHandoff] = useState("");
  const [error, setError] = useState("");
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const mediaRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeRef = useRef(false);
  const dispatchedRef = useRef(false);
  const knownMessageIdsRef = useRef(new Set<string>());
  const spokenMessageIdsRef = useRef(new Set<string>());

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
    setError("");
    setPhase("idle");
  }, [releaseBrowserMedia]);

  const start = useCallback(async () => {
    const threadId = props.threadId;
    if (!threadId || !props.enabled) return;
    setError("");
    setTranscript("");
    setHandoff("");
    setPhase("requesting");
    dispatchedRef.current = false;
    knownMessageIdsRef.current = new Set(props.messages.map((message) => message.id));
    spokenMessageIdsRef.current = new Set();

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
        } else if (event.type === "handoff") {
          setHandoff(event.text);
          if (event.callId && channel.readyState === "open") {
            channel.send(
              JSON.stringify({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: event.callId,
                  output: JSON.stringify({ queued: true, requires_user_confirmation: true }),
                },
              }),
            );
            channel.send(JSON.stringify({ type: "response.create" }));
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

  const active = phase !== "idle";
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
                : "Start Live Thread";

  return (
    <div className="relative flex shrink-0 items-center">
      <audio ref={audioRef} autoPlay className="hidden" />
      {active ? (
        <div className="border-border/70 bg-background/98 absolute right-0 bottom-full z-50 mb-2 w-[min(24rem,calc(100vw-2rem))] border p-3 shadow-xl backdrop-blur-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <WavesIcon className={cn("size-4", phase === "listening" && "text-emerald-400")} />
              <div className="min-w-0">
                <p className="text-foreground text-xs font-medium">Live Thread</p>
                <p className="text-muted-foreground truncate text-[11px]">{status}</p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => void stop()}
              aria-label="Stop Live Thread"
            >
              <SquareIcon className="size-3.5" />
            </Button>
          </div>
          {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
          {transcript && !handoff ? (
            <p className="text-muted-foreground mt-2 line-clamp-3 text-xs leading-5">
              {transcript}
            </p>
          ) : null}
          {handoff ? (
            <div className="border-border/70 mt-3 border-t pt-3">
              <p className="text-foreground/90 line-clamp-4 text-xs leading-5">{handoff}</p>
              <Button type="button" size="sm" className="mt-3 w-full" onClick={dispatch}>
                <ArrowUpIcon className="size-3.5" />
                Send to Codex
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant={active ? "secondary" : "ghost"}
              size="icon-sm"
              disabled={
                !props.enabled ||
                phase === "requesting" ||
                phase === "connecting" ||
                phase === "stopping"
              }
              onClick={() => (active ? void stop() : void start())}
              aria-label={active ? "Stop Live Thread" : "Start Live Thread"}
              className={cn(active && "text-emerald-400")}
            >
              {active ? <SquareIcon className="size-3.5" /> : <MicIcon className="size-4" />}
            </Button>
          }
        />
        <TooltipPopup side="top">
          {props.enabled
            ? active
              ? "Stop Live Thread"
              : "Talk through this task"
            : "Live Thread requires an active Codex task"}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

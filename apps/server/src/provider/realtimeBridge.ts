import {
  RealtimeAppendSpeechInput,
  RealtimeBridgeError,
  RealtimeStartInput,
  RealtimeStopInput,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Encoding from "effect/Encoding";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const KEYCHAIN_SERVICE = "com.openai.live-thread";
const KEYCHAIN_ACCOUNT = "openai-api";
const encodeJson = Schema.encodeUnknownEffect(Schema.UnknownFromJsonString);

export function buildRealtimeSession(input: RealtimeStartInput) {
  return {
    type: "realtime",
    model: "gpt-realtime-2.1",
    output_modalities: ["audio"],
    reasoning: { effort: "low" },
    instructions: [
      "You are Live Thread, a concise voice partner inside the current T3 Code task.",
      input.prompt ?? "Help the user think through the current coding task.",
      "Ask one useful question at a time and keep spoken replies brief.",
      "Never dispatch merely because the user mentions an idea.",
      "Only call send_to_codex after an explicit request to send, dispatch, hand off, or start work.",
      "Turn a dispatch into a self-contained Codex instruction with objective, constraints, and expected proof.",
      "The tool only prepares a draft; T3 Code still requires the user to click Send to Codex.",
    ].join(" "),
    audio: {
      input: {
        transcription: { model: "gpt-4o-mini-transcribe" },
        turn_detection: { type: "semantic_vad" },
      },
      output: { voice: input.voice ?? "marin" },
    },
    tools: [
      {
        type: "function",
        name: "send_to_codex",
        description:
          "Prepare a polished instruction for the current Codex task after the user explicitly asks to dispatch work.",
        parameters: {
          type: "object",
          properties: {
            instruction: {
              type: "string",
              description:
                "A self-contained Codex task with objective, constraints, and verification expectations.",
            },
            summary: {
              type: "string",
              description: "A short spoken confirmation of what is ready to send.",
            },
          },
          required: ["instruction", "summary"],
          additionalProperties: false,
        },
      },
    ],
    tool_choice: "auto",
  } as const;
}

const collectText = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

const readRealtimeApiKey = Effect.gen(function* () {
  const environmentKey =
    process.env.T3CODE_LIVE_THREAD_API_KEY?.trim() ?? process.env.OPENAI_API_KEY?.trim();
  if (environmentKey) return environmentKey;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* Effect.gen(function* () {
    const child = yield* spawner.spawn(
      ChildProcess.make("/usr/bin/security", [
        "find-generic-password",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        KEYCHAIN_ACCOUNT,
        "-w",
      ]),
    );
    const [stdout, exitCode] = yield* Effect.all([collectText(child.stdout), child.exitCode], {
      concurrency: "unbounded",
    });
    return Number(exitCode) === 0 ? stdout.trim() : "";
  }).pipe(
    Effect.scoped,
    Effect.orElseSucceed(() => ""),
  );
});

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "The OpenAI Realtime handshake failed.";
}

function bridgeError(threadId: RealtimeStartInput["threadId"], cause: unknown) {
  return new RealtimeBridgeError({ threadId, message: errorMessage(cause) });
}

export const startRealtimeBridge = Effect.fn("startRealtimeBridge")((input: RealtimeStartInput) =>
  Effect.gen(function* () {
    const apiKey = yield* readRealtimeApiKey;
    if (!apiKey) {
      return yield* new RealtimeBridgeError({
        threadId: input.threadId,
        message:
          "Live Thread needs an OpenAI API key in the existing Live Thread Keychain entry or T3CODE_LIVE_THREAD_API_KEY.",
      });
    }

    const [session, crypto, client] = yield* Effect.all([
      encodeJson(buildRealtimeSession(input)),
      Crypto.Crypto,
      HttpClient.HttpClient,
    ]);
    const safetyIdentifier = yield* crypto
      .digest("SHA-256", new TextEncoder().encode(`t3-code-live:${input.threadId}`))
      .pipe(Effect.map(Encoding.encodeHex));
    const request = HttpClientRequest.post(OPENAI_REALTIME_CALLS_URL).pipe(
      HttpClientRequest.bearerToken(apiKey),
      HttpClientRequest.setHeader("OpenAI-Safety-Identifier", safetyIdentifier),
      HttpClientRequest.bodyFormDataRecord({ sdp: input.sdp, session }),
    );
    const response = yield* client.execute(request);
    const body = yield* response.text;
    if (response.status < 200 || response.status >= 300) {
      const detail = body.trim().slice(0, 500) || "No response detail";
      return yield* new RealtimeBridgeError({
        threadId: input.threadId,
        message: `OpenAI Realtime rejected the session (${response.status}): ${detail}`,
      });
    }
    if (!body.trim()) {
      return yield* new RealtimeBridgeError({
        threadId: input.threadId,
        message: "OpenAI Realtime returned an empty SDP answer.",
      });
    }
    return { sdp: body };
  }).pipe(Effect.mapError((cause) => bridgeError(input.threadId, cause))),
);

// Audio and event transport are browser-managed after the SDP exchange. These
// RPCs remain as compatibility no-ops for an older renderer during an update.
export const stopRealtimeBridge = Effect.fn("stopRealtimeBridge")(
  (_input: RealtimeStopInput) => Effect.void,
);

export const appendRealtimeSpeechBridge = Effect.fn("appendRealtimeSpeechBridge")(
  (_input: RealtimeAppendSpeechInput) => Effect.void,
);

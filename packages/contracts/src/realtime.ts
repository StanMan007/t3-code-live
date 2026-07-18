import * as Schema from "effect/Schema";

import { ThreadId } from "./baseSchemas.ts";

export const RealtimeStartInput = Schema.Struct({
  threadId: ThreadId,
  sdp: Schema.String,
  prompt: Schema.optional(Schema.String),
  voice: Schema.optional(Schema.String),
});
export type RealtimeStartInput = typeof RealtimeStartInput.Type;

export const RealtimeStartResult = Schema.Struct({
  sdp: Schema.String,
});
export type RealtimeStartResult = typeof RealtimeStartResult.Type;

export const RealtimeStopInput = Schema.Struct({
  threadId: ThreadId,
});
export type RealtimeStopInput = typeof RealtimeStopInput.Type;

export const RealtimeAppendSpeechInput = Schema.Struct({
  threadId: ThreadId,
  text: Schema.String,
});
export type RealtimeAppendSpeechInput = typeof RealtimeAppendSpeechInput.Type;

export class RealtimeBridgeError extends Schema.TaggedErrorClass<RealtimeBridgeError>()(
  "RealtimeBridgeError",
  {
    threadId: ThreadId,
    message: Schema.String,
  },
) {}

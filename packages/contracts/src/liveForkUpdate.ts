import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const LiveForkUpdateInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type LiveForkUpdateInput = typeof LiveForkUpdateInput.Type;

export const LiveForkUpdateStatus = Schema.Literals([
  "current",
  "available",
  "merged",
  "needs_agent",
  "unavailable",
]);
export type LiveForkUpdateStatus = typeof LiveForkUpdateStatus.Type;

export const LiveForkUpdateResult = Schema.Struct({
  status: LiveForkUpdateStatus,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  currentSha: Schema.NullOr(TrimmedNonEmptyString),
  upstreamSha: Schema.NullOr(TrimmedNonEmptyString),
  localAhead: NonNegativeInt,
  upstreamAhead: NonNegativeInt,
  conflictingFiles: Schema.Array(TrimmedNonEmptyString),
  detail: Schema.optional(TrimmedNonEmptyString),
});
export type LiveForkUpdateResult = typeof LiveForkUpdateResult.Type;

export const LiveForkRebuildResult = Schema.Struct({
  status: Schema.Literal("started"),
  logPath: TrimmedNonEmptyString,
});
export type LiveForkRebuildResult = typeof LiveForkRebuildResult.Type;

export class LiveForkRebuildError extends Schema.TaggedErrorClass<LiveForkRebuildError>()(
  "LiveForkRebuildError",
  {
    cwd: TrimmedNonEmptyString,
    detail: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Could not rebuild T3 Code Live from ${this.cwd}: ${this.detail}`;
  }
}

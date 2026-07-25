import { describe, expect, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";

import {
  filterCompatibleAccountEntries,
  resolveRoutedAccountInstanceIds,
} from "./composerAccountRouting";

const claude = ProviderDriverKind.make("claudeAgent");
const codex = ProviderDriverKind.make("codex");

const entries = [
  { id: "claude-dossierx", driverKind: claude, enabled: true },
  { id: "claude-vero", driverKind: claude, enabled: true },
  { id: "claude-disabled", driverKind: claude, enabled: false },
  { id: "codex-dossierx", driverKind: codex, enabled: true },
  { id: "codex-personal", driverKind: codex, enabled: true },
] as const;

describe("filterCompatibleAccountEntries", () => {
  it("shows only enabled Claude accounts for a Claude model", () => {
    expect(filterCompatibleAccountEntries(entries, claude).map((entry) => entry.id)).toEqual([
      "claude-dossierx",
      "claude-vero",
    ]);
  });

  it("shows only enabled OpenAI accounts for a Codex model", () => {
    expect(filterCompatibleAccountEntries(entries, codex).map((entry) => entry.id)).toEqual([
      "codex-dossierx",
      "codex-personal",
    ]);
  });
});

describe("resolveRoutedAccountInstanceIds", () => {
  it("matches provider families by stable route key instead of display text", () => {
    const claudeWork = ProviderInstanceId.make("claude_work");
    const codexPersonal = ProviderInstanceId.make("codex_personal");
    const codexWork = ProviderInstanceId.make("codex_work");
    const routed = resolveRoutedAccountInstanceIds(
      [
        {
          instanceId: claudeWork,
          driverKind: claude,
          accountRouteKey: "work",
          displayName: "Claude Primary",
        },
        {
          instanceId: codexPersonal,
          driverKind: codex,
          accountRouteKey: "personal",
          displayName: "OpenAI A",
        },
        {
          instanceId: codexWork,
          driverKind: codex,
          accountRouteKey: "work",
          displayName: "OpenAI B",
        },
      ],
      new Set([claudeWork, codexPersonal, codexWork]),
      claudeWork,
      false,
    );

    expect([...routed]).toEqual([claudeWork, codexWork]);
  });

  it("keeps an existing task on its exact provider instance", () => {
    const claudeWork = ProviderInstanceId.make("claude_work");
    const codexWork = ProviderInstanceId.make("codex_work");
    const routed = resolveRoutedAccountInstanceIds(
      [
        { instanceId: claudeWork, driverKind: claude, accountRouteKey: "work" },
        { instanceId: codexWork, driverKind: codex, accountRouteKey: "work" },
      ],
      new Set([claudeWork, codexWork]),
      claudeWork,
      true,
    );

    expect([...routed]).toEqual([claudeWork]);
  });
});

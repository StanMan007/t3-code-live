import type {
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";

export function filterCompatibleAccountEntries<
  T extends {
    readonly driverKind: ProviderDriverKind;
    readonly enabled: boolean;
  },
>(entries: ReadonlyArray<T>, activeDriverKind: ProviderDriverKind): T[] {
  return entries.filter(
    (entry) => entry.enabled && entry.driverKind === activeDriverKind,
  );
}

export function resolveRoutedAccountInstanceIds<
  T extends {
    readonly instanceId: ProviderInstanceId;
    readonly driverKind: ProviderDriverKind;
    readonly accountRouteKey?: string | undefined;
  },
>(
  entries: ReadonlyArray<T>,
  selectableInstanceIds: ReadonlySet<ProviderInstanceId>,
  activeInstanceId: ProviderInstanceId,
  providerLocked: boolean,
): ReadonlySet<ProviderInstanceId> {
  if (providerLocked) {
    return new Set([activeInstanceId]);
  }

  const activeEntry = entries.find((entry) => entry.instanceId === activeInstanceId);
  const routed = new Set<ProviderInstanceId>();
  for (const driverKind of ["claudeAgent", "codex"] as const) {
    const candidates = entries.filter(
      (entry) =>
        entry.driverKind === driverKind &&
        selectableInstanceIds.has(entry.instanceId),
    );
    const matchingAccount = activeEntry?.accountRouteKey
      ? candidates.find(
          (entry) => entry.accountRouteKey === activeEntry.accountRouteKey,
        )
      : undefined;
    const target = matchingAccount ?? candidates[0];
    if (target) {
      routed.add(target.instanceId);
    }
  }
  if (routed.size === 0) {
    routed.add(activeInstanceId);
  }
  return routed;
}

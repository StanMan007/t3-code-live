export function applyModelRoutePrefix(prefix: string, model: string): string {
  const normalizedPrefix = prefix.trim().replace(/\/+$/u, "");
  if (normalizedPrefix.length === 0 || model.startsWith(`${normalizedPrefix}/`)) {
    return model;
  }
  return `${normalizedPrefix}/${model}`;
}

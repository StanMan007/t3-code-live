interface ThreadWithSessionStatus {
  readonly session: {
    readonly status: string;
  } | null;
}

export function countActiveTasksForRestart(
  threads: ReadonlyArray<ThreadWithSessionStatus>,
): number {
  return threads.filter(
    (thread) => thread.session?.status === "starting" || thread.session?.status === "running",
  ).length;
}

export type WorkerPing = { latencyMs: number; checkedAt: number };

/** Full HTTP round trip to this site's Worker, separate from the room socket. */
export async function measureWorkerPing(
  signal: AbortSignal,
): Promise<WorkerPing> {
  const started = performance.now();
  const response = await fetch("/api/health", { cache: "no-store", signal });
  if (!response.ok)
    throw new Error(`Health request failed: ${response.status}`);
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("status" in body) ||
    body.status !== "ok"
  ) {
    throw new Error("Invalid health response");
  }
  return {
    latencyMs: Math.max(0, Math.round(performance.now() - started)),
    checkedAt: Date.now(),
  };
}

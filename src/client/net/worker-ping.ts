import type { WorkerDiagnostics } from "../../shared/protocol/worker-diagnostics.js";

export type WorkerPing = {
  latencyMs: number;
  checkedAt: number;
  diagnostics: WorkerDiagnostics | null;
};

function boundedText(value: unknown, limit: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= limit
  );
}

function readDiagnostics(value: unknown): WorkerDiagnostics | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  if (
    !("worker" in value) ||
    !boundedText(value.worker, 128) ||
    !("hostname" in value) ||
    !boundedText(value.hostname, 253) ||
    !("runtime" in value) ||
    (value.runtime !== "cloudflare" &&
      value.runtime !== "local" &&
      value.runtime !== "unknown")
  ) {
    return null;
  }
  let cloudflare: WorkerDiagnostics["cloudflare"] = null;
  if (value.runtime === "cloudflare") {
    if (!("cloudflare" in value)) return null;
    const point = value.cloudflare;
    if (point !== null) {
      if (
        typeof point !== "object" ||
        Array.isArray(point) ||
        !("colo" in point) ||
        typeof point.colo !== "string" ||
        !/^[A-Z]{3}$/.test(point.colo) ||
        !("location" in point) ||
        (point.location !== null && !boundedText(point.location, 160)) ||
        !("region" in point) ||
        (point.region !== null && !boundedText(point.region, 80))
      ) {
        return null;
      }
      cloudflare = {
        colo: point.colo,
        location: point.location,
        region: point.region,
      };
    }
  }
  return {
    worker: value.worker,
    hostname: value.hostname,
    runtime: value.runtime,
    cloudflare,
  };
}

/** Full HTTP round trip to this site's Worker, separate from the room socket. */
export async function measureWorkerPing(
  signal: AbortSignal,
): Promise<WorkerPing> {
  const started = performance.now();
  const response = await fetch("/api/health?debug=1", {
    cache: "no-store",
    signal,
  });
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
    diagnostics: readDiagnostics(
      "diagnostics" in body ? body.diagnostics : null,
    ),
  };
}

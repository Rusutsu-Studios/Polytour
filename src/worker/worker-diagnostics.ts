import type { WorkerDiagnostics } from "../shared/protocol/worker-diagnostics.js";
import { CLOUDFLARE_LOCATIONS } from "./cloudflare-locations.js";

/** Request metadata identifies ingress; visitor geography must never fill gaps. */
export function workerDiagnostics(request: Request): WorkerDiagnostics {
  const hostname = new URL(request.url).hostname;
  const local =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname);
  const rawColo = request.cf?.colo;
  const colo =
    !local && typeof rawColo === "string" && /^[A-Z]{3}$/.test(rawColo)
      ? rawColo
      : null;
  const location = colo ? CLOUDFLARE_LOCATIONS[colo] : undefined;
  return {
    worker: "polytour",
    hostname,
    runtime: local ? "local" : colo ? "cloudflare" : "unknown",
    cloudflare: colo
      ? {
          colo,
          location: location?.[0] ?? null,
          region: location?.[1] ?? null,
        }
      : null,
  };
}

import { CLOUDFLARE_LOCATIONS } from "../../shared/protocol/cloudflare-locations.js";

export type CloudflarePing = {
  latencyMs: number;
  checkedAt: number;
  hostname: string;
  runtime: "cloudflare" | "local" | "unknown";
  colo: string | null;
  location: string | null;
  region: string | null;
};

/** HTTP round trip to a static asset; the response identifies its Cloudflare edge. */
export async function measureCloudflarePing(
  signal: AbortSignal,
): Promise<CloudflarePing> {
  const started = performance.now();
  const response = await fetch("/connection-probe.txt", {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`Connection probe failed: ${response.status}`);
  }
  if ((await response.text()).trim() !== "polytour-connection-probe-v1") {
    throw new Error("Invalid connection probe response");
  }
  const latencyMs = Math.max(0, Math.round(performance.now() - started));
  const hostname = new URL(response.url || window.location.href).hostname;
  const ray = response.headers.get("cf-ray");
  const colo = ray?.match(/-([A-Z]{3})$/)?.[1] ?? null;
  const location =
    colo && Object.hasOwn(CLOUDFLARE_LOCATIONS, colo)
      ? CLOUDFLARE_LOCATIONS[colo]
      : undefined;
  const local =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]";
  return {
    latencyMs,
    checkedAt: Date.now(),
    hostname,
    runtime: colo ? "cloudflare" : local ? "local" : "unknown",
    colo,
    location: location?.[0] ?? null,
    region: location?.[1] ?? null,
  };
}

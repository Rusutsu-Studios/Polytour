/** Metadata returned by the same Worker request used to measure HTTP latency. */
export type WorkerDiagnostics = {
  /** Configured Worker service name; the hostname distinguishes its Preview. */
  worker: string;
  hostname: string;
  runtime: "cloudflare" | "local" | "unknown";
  /** The request's Cloudflare entry point, not the room's Durable Object location. */
  cloudflare: {
    colo: string;
    location: string | null;
    region: string | null;
  } | null;
};

import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import type { WorkerDiagnostics } from "../src/shared/protocol/worker-diagnostics.js";

async function health(hostname: string, cf?: Record<string, unknown>) {
  return exports.default.fetch(
    new Request(`https://${hostname}/api/health?debug=1`, { cf }),
  );
}

describe("Worker HTTP diagnostics", () => {
  // The first request in this file starts the Worker. With the Durable Object
  // suites running in parallel, that cold start alone can pass the 5 s test
  // timeout, so it is paid here rather than inside the first assertion.
  beforeAll(async () => {
    await health("warm-up.polytour.example");
  }, 30_000);

  it("returns the request's POP, not the visitor's city or region", async () => {
    const response = await health("preview.polytour.example", {
      colo: "FRA",
      city: "Sydney",
      region: "New South Wales",
      country: "AU",
      clientTcpRtt: 1,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "ok",
      diagnostics: {
        worker: "polytour",
        hostname: "preview.polytour.example",
        runtime: "cloudflare",
        cloudflare: {
          colo: "FRA",
          location: "Frankfurt, Germany",
          region: "Europe",
        },
      },
    });
  });

  it.each([
    ["ZRH", "Zurich, Switzerland", "Europe"],
    ["NRT", "Tokyo, Japan", "Asia"],
    ["SYD", "Sydney, NSW, Australia", "Oceania"],
  ])(
    "maps %s to its official location and region",
    async (colo, location, region) => {
      const response = await health("polytour.example", { colo });
      const body = await response.json<{ diagnostics: WorkerDiagnostics }>();
      expect(body.diagnostics.cloudflare).toEqual({ colo, location, region });
    },
  );

  it.each(["localhost", "demo.localhost", "127.0.0.1", "[::1]"])(
    "identifies %s as local even when the emulator supplies a POP",
    async (hostname) => {
      const response = await health(hostname, { colo: "SFO" });
      const body = await response.json<{ diagnostics: WorkerDiagnostics }>();
      expect(body.diagnostics).toEqual({
        worker: "polytour",
        hostname,
        runtime: "local",
        cloudflare: null,
      });
    },
  );

  it("keeps a new POP code even when its location is not in the bundled list", async () => {
    const response = await health("polytour.example", { colo: "XZZ" });
    const body = await response.json<{ diagnostics: WorkerDiagnostics }>();
    expect(body.diagnostics.cloudflare).toEqual({
      colo: "XZZ",
      location: null,
      region: null,
    });
    expect(body.diagnostics.runtime).toBe("cloudflare");
  });

  it.each([
    undefined,
    { city: "Paris", region: "Ile-de-France" },
    { colo: "invalid" },
  ])(
    "does not invent a server location when POP metadata is missing or invalid",
    async (cf) => {
      const response = await health("polytour.example", cf);
      const body = await response.json<{ diagnostics: WorkerDiagnostics }>();
      expect(body.diagnostics.cloudflare).toBeNull();
      expect(body.diagnostics.runtime).toBe("unknown");
    },
  );

  it("preserves the monitoring response outside the explicit debug request", async () => {
    for (const query of ["", "?debug=0"]) {
      const response = await exports.default.fetch(
        new Request(`https://polytour.example/api/health${query}`),
      );
      expect(await response.json()).toEqual({ status: "ok" });
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
  });
});

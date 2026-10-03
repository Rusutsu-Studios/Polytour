import { useLayoutEffect, useState } from "react";
import {
  type CloudflarePing,
  measureCloudflarePing,
} from "./cloudflare-ping.js";

const PING_INTERVAL_MS = 5_000;
const PING_TIMEOUT_MS = 5_000;

export type PingState = (
  | { status: "loading" }
  | { status: "success"; value: CloudflarePing }
  | { status: "error" }
) & { connection: string };

/** One shared sample stream for the match HUD and its debug settings. */
export function useCloudflarePing(
  active: boolean,
  connection: string,
): PingState {
  const [ping, setPing] = useState<PingState>({
    status: "loading",
    connection,
  });
  // Teardown must finish before a hidden panel can receive another timer/network event.
  useLayoutEffect(() => {
    if (!active) return;
    let disposed = false;
    type Attempt = {
      controller: AbortController;
      timeout: ReturnType<typeof setTimeout> | undefined;
    };
    let pending: Attempt | null = null;
    const cancelPending = () => {
      const attempt = pending;
      pending = null;
      if (!attempt) return;
      clearTimeout(attempt.timeout);
      attempt.controller.abort();
    };
    const measure = async () => {
      if (disposed || pending || document.hidden || !navigator.onLine) return;
      const attempt: Attempt = {
        controller: new AbortController(),
        timeout: undefined,
      };
      pending = attempt;
      attempt.timeout = setTimeout(() => {
        if (pending !== attempt) return;
        // Free the slot even if an interrupted transport does not settle promptly.
        pending = null;
        attempt.controller.abort();
        if (!disposed) setPing({ status: "error", connection });
      }, PING_TIMEOUT_MS);
      try {
        const value = await measureCloudflarePing(attempt.controller.signal);
        if (!disposed && pending === attempt) {
          setPing({ status: "success", value, connection });
        }
      } catch {
        if (!disposed && pending === attempt) {
          setPing({ status: "error", connection });
        }
      } finally {
        clearTimeout(attempt.timeout);
        // A superseded request cannot unlock or overwrite a newer measurement.
        if (pending === attempt) pending = null;
      }
    };
    const restart = () => {
      cancelPending();
      if (!navigator.onLine) {
        setPing({ status: "error", connection });
      } else {
        setPing({ status: "loading", connection });
        void measure();
      }
    };
    const network = (navigator as Navigator & { connection?: EventTarget })
      .connection;
    window.addEventListener("online", restart);
    window.addEventListener("offline", restart);
    document.addEventListener("visibilitychange", restart);
    network?.addEventListener("change", restart);
    restart();
    const interval = setInterval(() => void measure(), PING_INTERVAL_MS);
    return () => {
      disposed = true;
      clearInterval(interval);
      window.removeEventListener("online", restart);
      window.removeEventListener("offline", restart);
      document.removeEventListener("visibilitychange", restart);
      network?.removeEventListener("change", restart);
      cancelPending();
    };
  }, [active, connection]);
  // Hide a previous connection's data before its replacement effect starts.
  return ping.connection === connection
    ? ping
    : { status: "loading", connection };
}

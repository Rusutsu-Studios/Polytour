import { useEffect, useState } from "react";

import "./App.css";

type Health = { status: "ok" };
type Hello = { status: "ok"; type: "phase0.hello" };

const FOUNDATIONS = [
  "Authoritative match server",
  "Deterministic rules engine",
  "Playable multiplayer board",
];

function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [socketReady, setSocketReady] = useState(false);

  useEffect(() => {
    void fetch("/api/health")
      .then((response) => response.json() as Promise<Health>)
      .then(setHealth)
      .catch(() => setHealth(null));

    if (!import.meta.env.DEV) {
      return;
    }

    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(
      `${scheme}://${window.location.host}/ws/debug/hello`,
    );

    socket.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (typeof event.data !== "string") {
        return;
      }

      const message = JSON.parse(event.data) as Hello;
      setSocketReady(
        message.type === "phase0.hello" && message.status === "ok",
      );
    });

    return () => socket.close();
  }, []);

  return (
    <main className="landing-shell">
      <section className="hero-card" aria-labelledby="page-title">
        <p className="eyebrow">A strategy board game in development</p>
        <h1 id="page-title">Polytour</h1>
        <p className="intro">
          Build, buy out, and outsmart your rivals in fast online property
          matches.
        </p>
        <p className="service-status" role="status">
          {socketReady
            ? "Game room WebSocket ready"
            : health?.status === "ok"
              ? "Opening game room WebSocket…"
              : "Connecting to game server…"}
        </p>
      </section>

      <section className="foundation-card" aria-labelledby="foundation-title">
        <p className="eyebrow">Current build</p>
        <h2 id="foundation-title">Phase 0: foundations</h2>
        <ol>
          {FOUNDATIONS.map((foundation, index) => (
            <li key={foundation}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {foundation}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

export default App;

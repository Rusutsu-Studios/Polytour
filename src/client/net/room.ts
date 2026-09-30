import { useEffect, useRef, useState } from "react";
import type { Action } from "../../shared/engine/index.js";
import type {
  ClientMessage,
  LobbyState,
  RandomnessStatus,
  RoomConfig,
  RoomCredentials,
  ServerMessage,
} from "../../shared/protocol/index.js";
import { PROTOCOL_VERSION } from "../../shared/protocol/index.js";
import { director } from "../director/director.js";
import { parseServerMessage } from "./server-message.js";

const STORAGE_KEY = "polytour-room-v1";
export type Connection = "connecting" | "online" | "reconnecting" | "offline";

export function readCredentials(): RoomCredentials | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== "object" ||
      !value ||
      !("roomCode" in value) ||
      !("token" in value) ||
      !("seat" in value)
    )
      return null;
    if (
      typeof value.roomCode !== "string" ||
      typeof value.token !== "string" ||
      typeof value.seat !== "number" ||
      value.seat < 0 ||
      value.seat > 3
    )
      return null;
    return value as RoomCredentials;
  } catch {
    return null;
  }
}
export function forgetCredentials() {
  sessionStorage.removeItem(STORAGE_KEY);
}
export async function enterRoom(
  name: string,
  config?: RoomConfig,
  code?: string,
): Promise<RoomCredentials> {
  const response = await fetch(
    code ? `/api/rooms/${code}/join` : "/api/rooms",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(code ? { name } : { name, config }),
    },
  );
  const body = (await response.json()) as RoomCredentials & {
    error?: string;
    message?: string;
  };
  if (!response.ok) {
    const messages: Record<string, string> = {
      "room-not-found":
        "Cette salle n’existe pas. Vérifiez les six caractères du code.",
      "room-full": "Cette salle est complète. Créez une nouvelle partie.",
      "game-started": "La partie a déjà commencé. Rejoignez un autre salon.",
    };
    throw new Error(
      messages[body.error ?? ""] ??
        body.message ??
        "Impossible d’ouvrir la salle. Réessayez.",
    );
  }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(body));
  return body;
}

export function useRoom(credentials: RoomCredentials | null) {
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [connection, setConnection] = useState<Connection>("offline");
  const [error, setError] = useState<string | null>(null);
  const [randomness, setRandomness] = useState<RandomnessStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState(0);
  const socket = useRef<WebSocket | null>(null);
  const sequence = useRef(0);
  const pendingId = useRef<string | null>(null);
  const requestTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!credentials) {
      setLobby(null);
      setConnection("offline");
      return;
    }
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = retry > 0 ? 1 : 0;
    let incompatible = false;
    function connect() {
      if (disposed || !credentials) return;
      setConnection(attempt ? "reconnecting" : "connecting");
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(
        `${scheme}://${window.location.host}/ws/room/${credentials.roomCode}`,
        ["polytour", `seat.${credentials.token}`],
      );
      socket.current = ws;
      ws.addEventListener("open", () => {
        attempt = 0;
        setConnection("online");
        setError(null);
        ws.send(
          JSON.stringify({
            type: "sync",
            lastSeq: null,
          } satisfies ClientMessage),
        );
      });
      ws.addEventListener("message", (event: MessageEvent<unknown>) => {
        if (disposed || typeof event.data !== "string") return;
        let message: ServerMessage;
        try {
          message = parseServerMessage(event.data);
        } catch {
          setError(
            "La salle a envoyé une réponse incompatible. Actualisez la page pour reprendre votre place.",
          );
          return;
        }
        switch (message.type) {
          case "welcome":
            if (message.protocolVersion !== PROTOCOL_VERSION) {
              incompatible = true;
              setError(
                "Le jeu a été mis à jour. Actualisez la page pour retrouver votre salle.",
              );
              ws.close();
              return;
            }
            sequence.current = message.seq;
            setLobby(message.lobby);
            setRandomness(
              message.snapshot?.status === "finished"
                ? null
                : message.randomness,
            );
            director.reset(message.snapshot);
            setPending(false);
            pendingId.current = null;
            if (requestTimer.current) clearTimeout(requestTimer.current);
            break;
          case "events":
            if (message.toSeq <= sequence.current) break;
            if (message.fromSeq !== sequence.current + 1) {
              ws.send(
                JSON.stringify({
                  type: "sync",
                  lastSeq: null,
                } satisfies ClientMessage),
              );
              break;
            }
            sequence.current = message.toSeq;
            director.receive(message.events);
            if (message.proofs?.length)
              setRandomness({
                status: "resolved",
                proof: message.proofs[message.proofs.length - 1].proof,
              });
            if (message.events.some((event) => event.type === "GameOver"))
              setRandomness(null);
            break;
          case "lobby":
            setLobby(message.lobby);
            break;
          case "randomness":
            setRandomness(message);
            break;
          case "ack":
          case "reject":
            if (message.id === pendingId.current) {
              pendingId.current = null;
              setPending(false);
              if (requestTimer.current) clearTimeout(requestTimer.current);
            }
            if (message.type === "reject") {
              const reasons: Record<string, string> = {
                "decision-expired":
                  "Le temps de décision est écoulé. Le jeu applique le choix automatique.",
                "stale-state":
                  "La partie a avancé. Vos choix ont été actualisés, réessayez.",
                "randomness-pending":
                  "Le lancer attend son signal aléatoire. Patientez un instant.",
                "not-host": "Seul l’hôte peut démarrer ou régler la partie.",
              };
              setError(
                reasons[message.reason] ??
                  message.message ??
                  "Ce choix n’est plus disponible. Réessayez.",
              );
            }
            break;
          case "presence":
            setLobby((current) =>
              current
                ? {
                    ...current,
                    seats: current.seats.map((seat) =>
                      seat.seat === message.seat
                        ? {
                            ...seat,
                            online: message.status === "online",
                            control:
                              message.status === "bot" ? "bot" : seat.control,
                          }
                        : seat,
                    ),
                  }
                : current,
            );
            break;
          case "pong":
            break;
        }
      });
      ws.addEventListener("close", () => {
        if (disposed) return;
        if (incompatible) {
          setConnection("offline");
          return;
        }
        setPending(false);
        pendingId.current = null;
        attempt += 1;
        setConnection(attempt > 5 ? "offline" : "reconnecting");
        if (attempt <= 5)
          reconnectTimer = setTimeout(
            connect,
            Math.min(500 * 2 ** attempt, 8000),
          );
        else
          setError(
            "La salle ne répond pas. Reconnectez-vous ou revenez à l’accueil.",
          );
      });
      ws.addEventListener("error", () => setConnection("reconnecting"));
    }
    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (requestTimer.current) clearTimeout(requestTimer.current);
      socket.current?.close();
      socket.current = null;
    };
  }, [credentials, retry]);

  function send(message: ClientMessage) {
    if (socket.current?.readyState !== WebSocket.OPEN) {
      setError("Connexion en cours. Attendez le retour de la salle.");
      return;
    }
    setError(null);
    if ("id" in message) {
      pendingId.current = message.id;
      setPending(true);
      if (requestTimer.current) clearTimeout(requestTimer.current);
      requestTimer.current = setTimeout(() => {
        pendingId.current = null;
        setPending(false);
        setError(
          "Votre choix n’a pas été confirmé. La salle est actualisée ; vérifiez le plateau avant de rejouer.",
        );
        if (socket.current?.readyState === WebSocket.OPEN)
          socket.current.send(
            JSON.stringify({
              type: "sync",
              lastSeq: null,
            } satisfies ClientMessage),
          );
      }, 10_000);
    }
    socket.current.send(JSON.stringify(message));
  }
  return {
    lobby,
    connection,
    error,
    randomness,
    pending,
    clearError: () => setError(null),
    reconnect: () => setRetry((value) => value + 1),
    act: (action: Action) =>
      send({
        type: "intent",
        id: crypto.randomUUID(),
        atSeq: sequence.current,
        action,
      }),
    start: (fillBots = true) =>
      send({
        type: "lobby",
        id: crypto.randomUUID(),
        op: { type: "start", fillBots },
      }),
    settings: (config: RoomConfig) =>
      send({
        type: "lobby",
        id: crypto.randomUUID(),
        op: { type: "settings", config },
      }),
  };
}

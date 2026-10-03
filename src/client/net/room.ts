import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Action, Seat } from "../../shared/engine/index.js";
import type {
  ClientMessage,
  LobbyOp,
  LobbyState,
  RandomnessStatus,
  RoomConfig,
  RoomCredentials,
  ServerMessage,
} from "../../shared/protocol/index.js";
import { PROTOCOL_VERSION } from "../../shared/protocol/index.js";
import { DEBUG_PING_RESPONSE } from "../../shared/protocol/room-diagnostics.js";
import { director } from "../director/director.js";
import { translate } from "../i18n.js";
import { RoomDebugController } from "./room-debug.js";
import { parseRoomResponse, RoomCredentialsSchema } from "./room-response.js";
import { parseServerMessage } from "./server-message.js";

const STORAGE_KEY = "polytour-room-v1";
export type Connection = "connecting" | "online" | "reconnecting" | "offline";

export function readCredentials(): RoomCredentials | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = RoomCredentialsSchema.safeParse(JSON.parse(raw) as unknown);
    return value.success ? value.data : null;
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
  bots = 0,
): Promise<RoomCredentials> {
  let response: Response;
  try {
    response = await fetch(code ? `/api/rooms/${code}/join` : "/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(code ? { name } : { name, config, bots }),
    });
  } catch {
    throw new Error(
      translate(
        "Impossible de joindre le serveur de jeu. Vérifiez votre connexion puis réessayez.",
        "Unable to reach the game server. Check your connection and try again.",
      ),
    );
  }
  const body = await parseRoomResponse(response);
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(body));
  return body;
}

/** Who this browser is in the room, as the server last welcomed it. */
export type RoomIdentity = { seat: Seat | null; member: string | null };

export function useRoom(credentials: RoomCredentials | null) {
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [you, setYou] = useState<RoomIdentity | null>(null);
  const [connection, setConnection] = useState<Connection>("offline");
  const [error, setError] = useState<string | null>(null);
  const [randomness, setRandomness] = useState<RandomnessStatus | null>(null);
  // What awaits the room's answer: a lobby operation's type, or "intent".
  // Screens show waiting only for their own command, not for every quick one.
  const [pendingOp, setPendingOp] = useState<string | null>(null);
  const pending = pendingOp !== null;
  const [leaving, setLeaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const leavingRequest = useRef(false);
  const disconnect = useRef<(() => void) | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const sequence = useRef(0);
  const pendingId = useRef<string | null>(null);
  const requestSync = useRef<(() => void) | null>(null);
  const requestTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [debugController] = useState(() => new RoomDebugController());
  const [debugActive, setDebugGate] = useState(false);
  const roomDebug = useSyncExternalStore(
    debugController.subscribe,
    debugController.getSnapshot,
  );
  const setDebugActive = useCallback(
    (active: boolean) => {
      if (active)
        debugController.setEnvironment(!document.hidden, navigator.onLine);
      debugController.setActive(active);
      setDebugGate(active);
    },
    [debugController],
  );

  useEffect(() => {
    if (!debugActive) return;
    const updateEnvironment = () =>
      debugController.setEnvironment(!document.hidden, navigator.onLine);
    updateEnvironment();
    document.addEventListener("visibilitychange", updateEnvironment);
    window.addEventListener("online", updateEnvironment);
    window.addEventListener("offline", updateEnvironment);
    return () => {
      document.removeEventListener("visibilitychange", updateEnvironment);
      window.removeEventListener("online", updateEnvironment);
      window.removeEventListener("offline", updateEnvironment);
      debugController.setEnvironment(false, navigator.onLine);
    };
  }, [debugActive, debugController]);

  useEffect(() => {
    function updateConnection(value: Connection) {
      setConnection(value);
      debugController.setConnection(value);
    }
    if (!credentials) {
      setLobby(null);
      setYou(null);
      debugController.setSocket(null);
      updateConnection("offline");
      setError(null);
      setRandomness(null);
      setPendingOp(null);
      pendingId.current = null;
      return;
    }
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let incompatible = false;
    function connect() {
      if (disposed || !credentials) return;
      updateConnection(attempt || retry > 0 ? "reconnecting" : "connecting");
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(
        `${scheme}://${window.location.host}/ws/room/${credentials.roomCode}`,
        ["polytour", `seat.${credentials.token}`],
      );
      socket.current = ws;
      debugController.setSocket(ws);
      let welcomed = false;
      let syncing = false;
      let welcomeTimer: ReturnType<typeof setTimeout> | undefined;
      function sync() {
        if (syncing || ws.readyState !== WebSocket.OPEN) return;
        syncing = true;
        if (welcomed) updateConnection("reconnecting");
        ws.send(
          JSON.stringify({
            type: "sync",
            lastSeq: null,
          } satisfies ClientMessage),
        );
        if (welcomeTimer) clearTimeout(welcomeTimer);
        welcomeTimer = setTimeout(() => {
          if (!disposed && syncing && socket.current === ws)
            ws.close(1000, "Room synchronization timed out");
        }, 10_000);
      }
      requestSync.current = sync;
      ws.addEventListener("open", () => {
        if (disposed || socket.current !== ws) return;
        // The upgrade alone does not mean the Durable Object loaded this room.
        // Keep actions blocked and the retry budget intact until its welcome.
        sync();
      });
      ws.addEventListener("message", (event: MessageEvent<unknown>) => {
        if (disposed || socket.current !== ws || typeof event.data !== "string")
          return;
        if (event.data === DEBUG_PING_RESPONSE) {
          debugController.receivePong(ws);
          return;
        }
        let message: ServerMessage;
        try {
          message = parseServerMessage(event.data);
        } catch {
          incompatible = true;
          setError(
            translate(
              "La salle a envoyé une réponse incompatible. Actualisez la page pour reprendre votre place.",
              "The room sent an incompatible response. Refresh the page to return to your seat.",
            ),
          );
          ws.close(1002, "Invalid room response");
          return;
        }
        if (!welcomed && message.type !== "welcome") return;
        switch (message.type) {
          case "welcome":
            if (message.protocolVersion !== PROTOCOL_VERSION) {
              incompatible = true;
              setError(
                translate(
                  "Le jeu a été mis à jour. Actualisez la page pour retrouver votre salle.",
                  "The game has been updated. Refresh the page to return to your room.",
                ),
              );
              ws.close();
              return;
            }
            welcomed = true;
            syncing = false;
            attempt = 0;
            if (welcomeTimer) clearTimeout(welcomeTimer);
            debugController.welcome(ws, message.roomDebugVersion);
            updateConnection("online");
            setError(null);
            sequence.current = message.seq;
            setLobby(message.lobby);
            // A waiting member can be welcomed again into a seat, and the
            // leader's return to the lobby welcomes everyone without a game.
            setYou(message.you);
            setRandomness(
              message.snapshot?.status === "finished"
                ? null
                : message.randomness,
            );
            director.reset(message.snapshot);
            setPendingOp(null);
            pendingId.current = null;
            if (requestTimer.current) clearTimeout(requestTimer.current);
            break;
          case "room-diagnostics":
            debugController.receiveDiagnostics(ws, message.value);
            break;
          case "events":
            if (syncing) break;
            if (message.toSeq <= sequence.current) break;
            if (message.fromSeq !== sequence.current + 1) {
              sync();
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
              setPendingOp(null);
              if (requestTimer.current) clearTimeout(requestTimer.current);
            }
            if (message.type === "reject") {
              const reasons: Record<string, readonly [string, string]> = {
                "decision-expired": [
                  "Le temps de décision est écoulé. Le jeu applique le choix automatique.",
                  "The decision time has expired. The game applies the automatic choice.",
                ],
                "stale-state": [
                  "La partie a avancé. Vos choix ont été actualisés, réessayez.",
                  "The game has moved on. Your choices have been updated; try again.",
                ],
                stale: [
                  "La partie a avancé. Vos choix ont été actualisés, réessayez.",
                  "The game has moved on. Your choices have been updated; try again.",
                ],
                "randomness-pending": [
                  "Le lancer attend son signal aléatoire. Patientez un instant.",
                  "The roll is waiting for its random result. Wait a moment.",
                ],
                "not-host": [
                  "Seul l’hôte peut démarrer ou régler la partie.",
                  "Only the host can start the game or change its settings.",
                ],
                "host-only": [
                  "Seul le chef de salle peut faire cela.",
                  "Only the room leader can do that.",
                ],
                "not-seated": [
                  "Vous attendez encore une place dans cette salle.",
                  "You are still waiting for a seat in this room.",
                ],
                "not-your-seat": [
                  "Ce joueur n’est pas sur votre écran.",
                  "That player is not on your screen.",
                ],
                "not-local": [
                  "Ce joueur ne partage plus un écran de la salle.",
                  "That player no longer shares a screen in this room.",
                ],
                "not-transferable": [
                  "Le rôle de chef ne peut aller qu’à une autre personne connectée avec son propre appareil.",
                  "The leader role can only go to another person on their own device.",
                ],
                "member-not-found": [
                  "Cette personne n’attend plus dans la salle.",
                  "That person is no longer waiting in this room.",
                ],
                "game-not-started": [
                  "La partie n’a pas encore commencé. Attendez le départ.",
                  "The game has not started yet. Wait for the host to start it.",
                ],
                "game-already-started": [
                  "La partie a déjà commencé. Les réglages sont fixés.",
                  "The game has already started. Its settings are locked.",
                ],
                "players-required": [
                  "Il faut au moins deux joueurs. Invitez un ami ou ajoutez un bot.",
                  "At least two players are needed. Invite a friend or add a bot.",
                ],
                "seat-taken": [
                  "Cette place vient d’être prise. La salle est à jour.",
                  "That seat was just taken. The room is up to date.",
                ],
                "not-a-bot": [
                  "Cette place n’est plus occupée par un bot.",
                  "That seat is no longer held by a bot.",
                ],
                "game-over": [
                  "La partie est terminée. Revenez à l’accueil pour en créer une autre.",
                  "The game has ended. Return to the home screen to create another.",
                ],
                "not-your-turn": [
                  "Ce choix appartient à un autre joueur. Attendez votre tour.",
                  "This decision belongs to another player. Wait for your turn.",
                ],
                "not-active-seat": [
                  "Ce choix appartient à un autre joueur. Attendez votre tour.",
                  "This decision belongs to another player. Wait for your turn.",
                ],
                "incompatible-saved-match": [
                  "Cette partie sauvegardée utilise une version incompatible. Revenez à l’accueil pour créer une partie.",
                  "This saved game uses an incompatible version. Return to the home screen to create a game.",
                ],
                "illegal-action": [
                  "Ce choix n’est plus disponible. Vérifiez les actions proposées.",
                  "This choice is no longer available. Check the available actions.",
                ],
              };
              const knownReason = reasons[message.reason];
              setError(
                knownReason
                  ? translate(...knownReason)
                  : (message.message ??
                      translate(
                        "Ce choix n’est plus disponible. Réessayez.",
                        "This choice is no longer available. Try again.",
                      )),
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
      ws.addEventListener("close", (event) => {
        if (welcomeTimer) clearTimeout(welcomeTimer);
        if (disposed || socket.current !== ws) return;
        debugController.disconnect(ws);
        requestSync.current = null;
        if (requestTimer.current) clearTimeout(requestTimer.current);
        setPendingOp(null);
        pendingId.current = null;
        if (incompatible) {
          updateConnection("offline");
          return;
        }
        if (
          event.code === 1008 ||
          event.code === 4003 ||
          event.reason === "Room expired"
        ) {
          updateConnection("offline");
          // The leave response may arrive after the server closes our socket.
          if (event.reason === "Left room" && leavingRequest.current) return;
          setError(
            event.reason === "Left room"
              ? translate(
                  "Vous avez quitté cette salle depuis un autre onglet. Revenez à l’accueil pour rejoindre une salle.",
                  "You left this room from another tab. Return to the home screen to join a room.",
                )
              : event.reason === "Room expired"
                ? translate(
                    "Cette salle a expiré. Revenez à l’accueil pour créer une partie.",
                    "This room has expired. Return to the home screen to create a game.",
                  )
                : event.code === 4003
                  ? translate(
                      "Le chef de salle n’a pas accepté votre entrée. Revenez à l’accueil pour rejoindre une autre partie.",
                      "The room leader did not let you in. Return to the home screen to join another game.",
                    )
                  : translate(
                      "La connexion à cette salle a été refusée. Actualisez la page ou revenez à l’accueil.",
                      "The room refused the connection. Refresh the page or return to the home screen.",
                    ),
          );
          return;
        }
        attempt += 1;
        updateConnection(attempt > 5 ? "offline" : "reconnecting");
        if (attempt <= 5)
          reconnectTimer = setTimeout(
            connect,
            Math.min(500 * 2 ** attempt, 8000),
          );
        else
          setError(
            translate(
              "La salle ne répond pas. Reconnectez-vous ou revenez à l’accueil.",
              "The room is not responding. Reconnect or return to the home screen.",
            ),
          );
      });
      ws.addEventListener("error", () => {
        if (!disposed && socket.current === ws)
          updateConnection("reconnecting");
      });
    }
    connect();
    function dispose() {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (requestTimer.current) clearTimeout(requestTimer.current);
      const ws = socket.current;
      if (ws) debugController.disconnect(ws);
      socket.current = null;
      requestSync.current = null;
      ws?.close();
    }
    disconnect.current = dispose;
    return () => {
      dispose();
      if (disconnect.current === dispose) disconnect.current = null;
    };
  }, [credentials, retry, debugController]);

  async function leave(): Promise<boolean> {
    if (leavingRequest.current) return false;
    if (!credentials) return true;
    leavingRequest.current = true;
    setLeaving(true);
    setError(null);
    const controller = new AbortController();
    const departureTimer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`/api/rooms/${credentials.roomCode}/leave`, {
        method: "POST",
        headers: { Authorization: `Bearer ${credentials.token}` },
        signal: controller.signal,
      });
      // An expired room or revoked capability already releases this local seat.
      if (response.status !== 401 && response.status !== 404) {
        if (response.status !== 200) throw new Error("Room departure failed");
        const body: unknown = await response.json();
        if (
          !body ||
          typeof body !== "object" ||
          !("ok" in body) ||
          body.ok !== true
        )
          throw new Error("Invalid room departure response");
      }
      disconnect.current?.();
      setConnection("offline");
      debugController.setConnection("offline");
      setPendingOp(null);
      pendingId.current = null;
      setError(null);
      return true;
    } catch {
      setError(
        translate(
          "Votre départ n’a pas été confirmé. Vérifiez votre connexion puis réessayez.",
          "Your departure was not confirmed. Check your connection and try again.",
        ),
      );
      return false;
    } finally {
      clearTimeout(departureTimer);
      leavingRequest.current = false;
      setLeaving(false);
    }
  }

  function send(message: ClientMessage) {
    if (leavingRequest.current) return;
    if (
      connection !== "online" ||
      socket.current?.readyState !== WebSocket.OPEN
    ) {
      setError(
        translate(
          "Connexion en cours. Attendez le retour de la salle.",
          "Connecting. Wait for the room to reconnect.",
        ),
      );
      return;
    }
    // React may not have rendered the disabled button yet after the first click.
    // Never send a second command while its predecessor is awaiting confirmation.
    if ("id" in message && pendingId.current) return;
    setError(null);
    if ("id" in message) {
      pendingId.current = message.id;
      setPendingOp(message.type === "lobby" ? message.op.type : message.type);
      if (requestTimer.current) clearTimeout(requestTimer.current);
      requestTimer.current = setTimeout(() => {
        pendingId.current = null;
        setPendingOp(null);
        setError(
          translate(
            "Votre choix n’a pas été confirmé. La salle est actualisée ; vérifiez le plateau avant de rejouer.",
            "Your choice was not confirmed. The room is being refreshed; check the board before playing again.",
          ),
        );
        requestSync.current?.();
      }, 10_000);
    }
    socket.current.send(JSON.stringify(message));
  }
  const lobbyOp = (op: LobbyOp) =>
    send({ type: "lobby", id: crypto.randomUUID(), op });
  return {
    lobby,
    you,
    connection,
    error,
    randomness,
    pending,
    pendingOp,
    leaving,
    leave,
    roomDebug,
    setDebugActive,
    clearError: () => setError(null),
    reconnect: () => {
      if (!leavingRequest.current) setRetry((value) => value + 1);
    },
    /** A local player's seat acts on this device's behalf when given. */
    act: (action: Action, seat?: Seat) =>
      send({
        type: "intent",
        id: crypto.randomUUID(),
        atSeq: sequence.current,
        action,
        ...(seat === undefined ? {} : { seat }),
      }),
    start: (fillBots = true) => lobbyOp({ type: "start", fillBots }),
    settings: (config: RoomConfig) => lobbyOp({ type: "settings", config }),
    addBot: (seat: Seat) => lobbyOp({ type: "add-bot", seat }),
    removeBot: (seat: Seat) => lobbyOp({ type: "remove-bot", seat }),
    addLocal: (seat: Seat, name: string) =>
      lobbyOp({ type: "add-local", seat, name }),
    removeLocal: (seat: Seat) => lobbyOp({ type: "remove-local", seat }),
    transferHost: (seat: Seat) => lobbyOp({ type: "transfer-host", seat }),
    lock: (locked: boolean) => lobbyOp({ type: "lock", locked }),
    admit: (member: string) => lobbyOp({ type: "admit", member }),
    deny: (member: string) => lobbyOp({ type: "deny", member }),
    replaceBot: (member: string, seat: Seat) =>
      lobbyOp({ type: "replace-bot", member, seat }),
    returnToLobby: () => lobbyOp({ type: "return-to-lobby" }),
  };
}

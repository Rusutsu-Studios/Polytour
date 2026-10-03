import {
  DEBUG_PING_REQUEST,
  ROOM_DEBUG_VERSION,
  type RoomDiagnostics,
  RoomDiagnosticsSchema,
} from "../../shared/protocol/room-diagnostics.js";

export type RoomDebugState = {
  status: "idle" | "loading" | "ready" | "unavailable";
  diagnostics: RoomDiagnostics | null;
  latencyMs: number | null;
  samples: Array<{ latencyMs: number; checkedAt: number }>;
  pingStatus: "idle" | "measuring" | "success" | "timeout";
  connection: string;
};

type DebugSocket = { readyState: number; send: (value: string) => void };
type Request = {
  generation: number;
  startedAt: number;
  expired: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};
type Clock = { now: () => number; checkedAt: () => number };
const PING_INTERVAL = 5_000;
const RESPONSE_TIMEOUT = 5_000;
const MAX_OUTSTANDING = 3;
const MAX_SAMPLES = 60;

/** Debug traffic shares the game socket without entering its command queue. */
export class RoomDebugController {
  private value: RoomDebugState = {
    status: "idle",
    diagnostics: null,
    latencyMs: null,
    samples: [],
    pingStatus: "idle",
    connection: "offline",
  };
  private listeners = new Set<() => void>();
  private socket: DebugSocket | null = null;
  private active = false;
  private visible = true;
  private online = true;
  private welcomed = false;
  private capable = false;
  private running = false;
  private generation = 0;
  private cadence: ReturnType<typeof setTimeout> | null = null;
  private pings: Request[] = [];
  private metadata: Request[] = [];
  private metadataSent = false;
  private clock: Clock;

  constructor(
    clock: Clock = {
      now: () => performance.now(),
      checkedAt: () => Date.now(),
    },
  ) {
    this.clock = clock;
  }

  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<RoomDebugState>) {
    this.value = { ...this.value, ...patch };
    for (const listener of this.listeners) listener();
  }

  setActive = (active: boolean) => {
    if (this.active === active) return;
    this.active = active;
    // Each opening gets current routing metadata, once, on the same socket.
    if (active) this.update({ diagnostics: null });
    this.reconcile();
  };

  setEnvironment(visible: boolean, online: boolean) {
    this.visible = visible;
    this.online = online;
    this.reconcile();
  }

  setConnection(connection: string) {
    if (connection !== this.value.connection) this.update({ connection });
    this.reconcile();
  }

  setSocket(socket: DebugSocket | null) {
    if (socket === this.socket) return;
    this.stop();
    // A different transport has its own FIFO. Old-socket replies are ignored.
    this.pings = [];
    this.metadata = [];
    this.socket = socket;
    this.welcomed = false;
    this.capable = false;
    this.update({ diagnostics: null, latencyMs: null, samples: [] });
    this.reconcile();
  }

  welcome(socket: DebugSocket, version: number | undefined) {
    if (socket !== this.socket) return;
    this.stop();
    this.welcomed = true;
    this.capable = version === ROOM_DEBUG_VERSION;
    this.update({ diagnostics: null });
    this.reconcile();
  }

  disconnect(socket: DebugSocket) {
    if (socket === this.socket) this.setSocket(null);
  }

  private enabled() {
    return Boolean(
      this.active &&
        this.visible &&
        this.online &&
        this.value.connection === "online" &&
        this.socket?.readyState === 1 &&
        this.welcomed &&
        this.capable,
    );
  }

  private reconcile() {
    if (!this.enabled()) {
      if (this.running) this.stop();
      const status = !this.active
        ? "idle"
        : this.value.diagnostics
          ? "ready"
          : this.welcomed && !this.capable
            ? "unavailable"
            : this.visible && this.online
              ? "loading"
              : "unavailable";
      if (this.value.status !== status || this.value.pingStatus !== "idle")
        this.update({ status, pingStatus: "idle" });
      return;
    }
    if (this.running) return;
    this.running = true;
    this.generation += 1;
    this.metadataSent = false;
    this.update({ status: this.value.diagnostics ? "ready" : "loading" });
    this.requestMetadata();
    this.ping();
    this.schedulePing();
  }

  private stop() {
    this.running = false;
    this.generation += 1;
    if (this.cadence !== null) clearTimeout(this.cadence);
    this.cadence = null;
    for (const request of [...this.pings, ...this.metadata]) {
      if (request.timer !== null) clearTimeout(request.timer);
      request.timer = null;
      request.expired = true;
    }
    if (this.value.pingStatus !== "idle") this.update({ pingStatus: "idle" });
  }

  private requestMetadata() {
    if (
      !this.running ||
      !this.socket ||
      this.value.diagnostics ||
      this.metadataSent
    )
      return;
    if (this.metadata.length >= MAX_OUTSTANDING) {
      this.update({ status: "unavailable" });
      return;
    }
    this.metadataSent = true;
    const request = this.request(() => this.update({ status: "unavailable" }));
    this.metadata.push(request);
    try {
      this.socket.send(JSON.stringify({ type: "debug-info" }));
    } catch {
      this.removeUnsent(this.metadata, request);
      this.update({ status: "unavailable" });
    }
  }

  private request(onTimeout: () => void): Request {
    const request: Request = {
      generation: this.generation,
      startedAt: this.clock.now(),
      expired: false,
      timer: null,
    };
    request.timer = setTimeout(() => {
      request.timer = null;
      request.expired = true;
      if (this.running && request.generation === this.generation) onTimeout();
    }, RESPONSE_TIMEOUT);
    return request;
  }

  private removeUnsent(queue: Request[], request: Request) {
    if (request.timer !== null) clearTimeout(request.timer);
    const index = queue.indexOf(request);
    if (index !== -1) queue.splice(index, 1);
  }

  private ping() {
    if (!this.running || !this.socket) return;
    if (this.pings.length >= MAX_OUTSTANDING) {
      this.update({ pingStatus: "timeout" });
      return;
    }
    const request = this.request(() => this.update({ pingStatus: "timeout" }));
    this.pings.push(request);
    this.update({ pingStatus: "measuring" });
    try {
      this.socket.send(DEBUG_PING_REQUEST);
    } catch {
      this.removeUnsent(this.pings, request);
      this.update({ pingStatus: "timeout" });
    }
  }

  private schedulePing() {
    this.cadence = setTimeout(() => {
      this.cadence = null;
      if (!this.enabled()) {
        this.reconcile();
        return;
      }
      this.ping();
      this.schedulePing();
    }, PING_INTERVAL);
  }

  /** Fixed pongs have no ID: every response consumes exactly its FIFO slot. */
  receivePong(socket: DebugSocket) {
    if (socket !== this.socket) return;
    const request = this.pings.shift();
    if (!request) return;
    if (request.timer !== null) clearTimeout(request.timer);
    if (
      request.expired ||
      request.generation !== this.generation ||
      !this.enabled()
    )
      return;
    const latencyMs = Math.max(
      0,
      Math.round(this.clock.now() - request.startedAt),
    );
    this.update({
      latencyMs,
      pingStatus: "success",
      samples: [
        ...this.value.samples,
        { latencyMs, checkedAt: this.clock.checkedAt() },
      ].slice(-MAX_SAMPLES),
    });
  }

  receiveDiagnostics(socket: DebugSocket, value: unknown) {
    if (socket !== this.socket) return;
    const request = this.metadata.shift();
    if (!request) return;
    if (request.timer !== null) clearTimeout(request.timer);
    if (
      request.expired ||
      request.generation !== this.generation ||
      !this.enabled()
    ) {
      this.requestMetadata();
      return;
    }
    const result = RoomDiagnosticsSchema.safeParse(value);
    this.update(
      result.success
        ? { status: "ready", diagnostics: result.data }
        : { status: "unavailable" },
    );
  }
}

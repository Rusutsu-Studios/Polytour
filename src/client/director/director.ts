import { useSyncExternalStore } from "react";
import type { GameEvent, PublicState } from "../../shared/engine/index.js";
import { applyEvent } from "../../shared/engine/index.js";

type SalaryPaid = Extract<GameEvent, { type: "SalaryPaid" }>;
export type AnimationContext = {
  previous: PublicState | null;
  next: PublicState;
  /** Events already received that will play after this one. */
  upcoming: readonly GameEvent[];
  /**
   * The salary a move earns by crossing Start. The scene credits it with
   * `settle` when the pawn passes Start instead of after the walk.
   */
  salary?: { event: SalaryPaid; settle: () => void };
  playbackRate: number;
  reducedMotion: boolean;
};
export type SceneAnimator = {
  animate: (event: GameEvent, context: AnimationContext) => Promise<void>;
  snap: (state: PublicState | null) => void;
  cancel: () => void;
};
type DirectorState = {
  serverState: PublicState | null;
  viewState: PublicState | null;
  busy: boolean;
  reducedMotion: boolean;
  history: readonly GameEvent[];
};

/** Server batches the view may trail before it plays faster to catch up. */
const CATCH_UP_BATCHES = 2;
const CATCH_UP_PLAYBACK_RATE = 2.5;
/** Beyond this backlog, snap to the server state instead of replaying it. */
const RECOVERY_BACKLOG = 40;

class Director {
  private value: DirectorState = {
    serverState: null,
    viewState: null,
    busy: false,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches,
    history: [],
  };
  private listeners = new Set<() => void>();
  private queue: { event: GameEvent; batch: number }[] = [];
  private batch = 0;
  private generation = 0;
  private animator: SceneAnimator | null = null;
  private presenter: SceneAnimator | null = null;

  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<DirectorState>) {
    this.value = { ...this.value, ...patch };
    for (const listener of this.listeners) listener();
  }
  register(animator: SceneAnimator) {
    this.animator = animator;
    animator.snap(this.value.viewState);
    return () => {
      if (this.animator === animator) this.animator = null;
      animator.cancel();
    };
  }
  /** DOM moments join the same event queue without replacing the 3D scene. */
  registerPresenter(presenter: SceneAnimator) {
    this.presenter?.cancel();
    this.presenter = presenter;
    presenter.snap(this.value.viewState);
    return () => {
      if (this.presenter === presenter) this.presenter = null;
      presenter.cancel();
    };
  }
  reset(state: PublicState | null) {
    this.generation += 1;
    this.queue = [];
    this.animator?.cancel();
    this.presenter?.cancel();
    this.update({
      serverState: state,
      viewState: state,
      busy: false,
      history: [],
    });
    this.animator?.snap(state);
    this.presenter?.snap(state);
  }
  receive(events: readonly GameEvent[]) {
    let state = this.value.serverState;
    for (const event of events) {
      if (event.type === "GameCreated") state = event.state;
      else if (state) state = applyEvent(state, event);
    }
    this.update({
      serverState: state,
      history: [...this.value.history, ...events].slice(-250),
    });
    this.batch += 1;
    for (const event of events) this.queue.push({ event, batch: this.batch });
    if (
      state?.pause?.kind === "paused" ||
      this.queue.length > RECOVERY_BACKLOG ||
      document.hidden
    )
      this.recoverToServer();
    else if (!this.value.busy) void this.drain(this.generation);
  }
  private async drain(generation: number) {
    this.update({ busy: true });
    while (this.queue.length && generation === this.generation) {
      const entry = this.queue.shift();
      if (!entry) break;
      const { event } = entry;
      // One server action arrives as one batch and plays at its normal rate.
      // Only a view several actions behind the server speeds up to catch up.
      const behind = this.batch - entry.batch;
      const previous = this.value.viewState;
      const following = this.queue[0]?.event;
      const salary =
        event.type === "PlayerMoved" &&
        following?.type === "SalaryPaid" &&
        following.seat === event.seat
          ? following
          : undefined;
      if (salary) this.queue.shift();
      const moved =
        event.type === "GameCreated"
          ? event.state
          : previous
            ? applyEvent(previous, event)
            : null;
      if (!moved) continue;
      const next = salary ? applyEvent(moved, salary) : moved;
      let settled = false;
      const settle = () => {
        const view = this.value.viewState;
        if (!salary || settled || !view) return;
        settled = true;
        this.update({ viewState: applyEvent(view, salary) });
      };
      if (this.animator || this.presenter) {
        const context = {
          previous,
          next,
          upcoming: this.queue.map((queued) => queued.event),
          playbackRate: behind >= CATCH_UP_BATCHES ? CATCH_UP_PLAYBACK_RATE : 1,
          reducedMotion: this.value.reducedMotion,
          salary: salary && { event: salary, settle },
        };
        await Promise.all([
          this.animator?.animate(event, context),
          this.presenter?.animate(event, context),
        ]);
      }
      if (generation !== this.generation) return;
      const view = this.value.viewState;
      this.update({
        viewState: settled && view ? applyEvent(view, event) : next,
      });
    }
    if (generation === this.generation) this.update({ busy: false });
  }
  recoverToServer = () => {
    this.generation += 1;
    this.queue = [];
    this.animator?.cancel();
    this.presenter?.cancel();
    this.update({ viewState: this.value.serverState, busy: false });
    this.animator?.snap(this.value.serverState);
    this.presenter?.snap(this.value.serverState);
  };
  setReducedMotion(reducedMotion: boolean) {
    this.update({ reducedMotion });
    if (reducedMotion) this.recoverToServer();
  }
}

export const director = new Director();
export function useDirector() {
  return useSyncExternalStore(director.subscribe, director.getSnapshot);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) director.recoverToServer();
});
window
  .matchMedia("(prefers-reduced-motion: reduce)")
  .addEventListener("change", (event) => {
    director.setReducedMotion(event.matches);
  });

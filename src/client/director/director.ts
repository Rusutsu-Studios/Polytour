import { useSyncExternalStore } from "react";
import type { GameEvent, PublicState } from "../../shared/engine/index.js";
import { applyEvent } from "../../shared/engine/index.js";

export type AnimationContext = {
  previous: PublicState | null;
  next: PublicState;
  speed: number;
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
  speed: 1 | 1.5 | 2;
  reducedMotion: boolean;
  history: readonly GameEvent[];
};

/** Server batches the view may trail before it plays faster to catch up. */
const CATCH_UP_BATCHES = 2;
const CATCH_UP_SPEED = 2.5;
/** Beyond this backlog, snap to the server state instead of replaying it. */
const SKIP_BACKLOG = 40;

class Director {
  private value: DirectorState = {
    serverState: null,
    viewState: null,
    busy: false,
    speed: 1,
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
    if (this.queue.length > SKIP_BACKLOG || document.hidden) this.skip();
    else if (!this.value.busy) void this.drain(this.generation);
  }
  private async drain(generation: number) {
    this.update({ busy: true });
    while (this.queue.length && generation === this.generation) {
      const entry = this.queue.shift();
      if (!entry) break;
      const { event } = entry;
      // One server action arrives as one batch and plays at the chosen
      // speed. Only a view several actions behind the server speeds up.
      const behind = this.batch - entry.batch;
      const previous = this.value.viewState;
      const next =
        event.type === "GameCreated"
          ? event.state
          : previous
            ? applyEvent(previous, event)
            : null;
      if (!next) continue;
      if (this.animator || this.presenter) {
        const context = {
          previous,
          next,
          speed:
            behind >= CATCH_UP_BATCHES
              ? Math.max(CATCH_UP_SPEED, this.value.speed)
              : this.value.speed,
          reducedMotion: this.value.reducedMotion,
        };
        await Promise.all([
          this.animator?.animate(event, context),
          this.presenter?.animate(event, context),
        ]);
      }
      if (generation !== this.generation) return;
      this.update({ viewState: next });
    }
    if (generation === this.generation) this.update({ busy: false });
  }
  skip = () => {
    this.generation += 1;
    this.queue = [];
    this.animator?.cancel();
    this.presenter?.cancel();
    this.update({ viewState: this.value.serverState, busy: false });
    this.animator?.snap(this.value.serverState);
    this.presenter?.snap(this.value.serverState);
  };
  setSpeed(speed: 1 | 1.5 | 2) {
    this.update({ speed });
  }
  setReducedMotion(reducedMotion: boolean) {
    this.update({ reducedMotion });
    if (reducedMotion) this.skip();
  }
}

export const director = new Director();
export function useDirector() {
  return useSyncExternalStore(director.subscribe, director.getSnapshot);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) director.skip();
});
window
  .matchMedia("(prefers-reduced-motion: reduce)")
  .addEventListener("change", (event) => {
    director.setReducedMotion(event.matches);
  });

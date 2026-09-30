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

class Director {
  private value: DirectorState = {
    serverState: null,
    viewState: null,
    busy: false,
    speed: 1.5,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches,
    history: [],
  };
  private listeners = new Set<() => void>();
  private queue: GameEvent[] = [];
  private generation = 0;
  private animator: SceneAnimator | null = null;

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
  reset(state: PublicState | null) {
    this.generation += 1;
    this.queue = [];
    this.animator?.cancel();
    this.update({
      serverState: state,
      viewState: state,
      busy: false,
      history: [],
    });
    this.animator?.snap(state);
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
    this.queue.push(...events);
    if (this.queue.length > 30 || document.hidden) this.skip();
    else if (!this.value.busy) void this.drain(this.generation);
  }
  private async drain(generation: number) {
    this.update({ busy: true });
    while (this.queue.length && generation === this.generation) {
      const event = this.queue.shift();
      if (!event) break;
      const previous = this.value.viewState;
      const next =
        event.type === "GameCreated"
          ? event.state
          : previous
            ? applyEvent(previous, event)
            : null;
      if (!next) continue;
      if (this.animator) {
        await this.animator.animate(event, {
          previous,
          next,
          speed: this.queue.length > 6 ? 3 : this.value.speed,
          reducedMotion: this.value.reducedMotion,
        });
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
    this.update({ viewState: this.value.serverState, busy: false });
    this.animator?.snap(this.value.serverState);
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

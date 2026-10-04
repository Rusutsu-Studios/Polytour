import { useThree } from "@react-three/fiber";
import { useEffect, useState } from "react";
import type { PublicState } from "../../shared/engine/index.js";
import { useDirector } from "../director/director.js";

/** Ambient life renders at this rate between game animations. */
const AMBIENT_FRAME_MS = 1000 / 30;

/**
 * Whether the board's idle life plays: the town's traffic and rides, the
 * stadium's trophy and the airport. It only plays during a match; lobby
 * previews, low graphics, reduced motion and hidden tabs keep the board still,
 * so an idle page never keeps rendering. While it plays, this one driver keeps
 * the demand-rendered canvas ticking for every ambient component.
 */
export function useAmbientMotion({
  state,
  preview = false,
  lowGraphics = false,
}: {
  state: PublicState | null;
  preview?: boolean;
  lowGraphics?: boolean;
}) {
  const { reducedMotion } = useDirector();
  const { invalidate } = useThree();
  const [visible, setVisible] = useState(
    () => document.visibilityState !== "hidden",
  );
  useEffect(() => {
    const changed = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  const animated =
    !reducedMotion &&
    !lowGraphics &&
    !preview &&
    state?.status === "active" &&
    state.pause?.kind !== "paused" &&
    visible;
  useEffect(() => {
    if (!animated) {
      // One last frame settles everything in its still pose.
      invalidate();
      return;
    }
    const timer = window.setInterval(() => invalidate(), AMBIENT_FRAME_MS);
    return () => window.clearInterval(timer);
  }, [animated, invalidate]);
  return animated;
}

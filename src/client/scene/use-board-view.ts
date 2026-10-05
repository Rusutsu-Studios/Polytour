import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { BOARD_ZOOM, clampBoardZoom } from "../board-view.js";
import {
  BOARD_DRAG_THRESHOLD,
  type BoardOrientation,
  type BoardPan,
  CENTERED_BOARD,
  clampBoardPan,
  DEFAULT_BOARD_ORIENTATION,
  rotateBoardOrientation,
} from "./board-framing.js";

/** User gestures change only framing; game animation remains with the Director. */
export function useBoardView({
  layer,
  enabled,
  zoom,
  onZoom,
  resetKey,
  limits,
  unitsPerPixel,
  orientation,
  onOrientation,
  canStartGesture,
}: {
  layer: RefObject<HTMLElement | null>;
  enabled: boolean;
  zoom: number;
  onZoom?: (zoom: number) => void;
  resetKey?: number;
  limits: BoardPan;
  unitsPerPixel: number;
  orientation: BoardOrientation;
  onOrientation: (orientation: BoardOrientation) => void;
  canStartGesture: (x: number, y: number) => boolean;
}) {
  const [pan, setPan] = useState(CENTERED_BOARD);
  const latest = useRef({
    enabled,
    zoom,
    onZoom,
    limits,
    unitsPerPixel,
    orientation,
    onOrientation,
    canStartGesture,
  });
  latest.current = {
    enabled,
    zoom,
    onZoom,
    limits,
    unitsPerPixel,
    orientation,
    onOrientation,
    canStartGesture,
  };
  const effectivePan = useMemo(() => clampBoardPan(pan, limits), [pan, limits]);

  // Menu reset works even while direct gestures are locked.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key deliberately requests a fresh centered view.
  useEffect(() => {
    setPan(CENTERED_BOARD);
    onOrientation(DEFAULT_BOARD_ORIENTATION);
  }, [resetKey, onOrientation]);
  useEffect(() => {
    setPan((value) => {
      const next = clampBoardPan(value, limits);
      return next.x === value.x && next.y === value.y ? value : next;
    });
  }, [limits]);

  useEffect(() => {
    const element = layer.current;
    if (!element) return;
    const pointers = new Map<number, BoardPan>();
    let start = CENTERED_BOARD;
    let last = CENTERED_BOARD;
    let dragged = false;
    let panGesture = false;
    let hovered = false;
    let pinch: { distance: number; zoom: number } | null = null;
    const active = () =>
      latest.current.enabled &&
      !Array.from(
        document.querySelectorAll(
          "dialog[open], [role='dialog'], [role='alertdialog']",
        ),
      ).some((dialog) => dialog.getClientRects().length > 0);
    const onBoard = (event: PointerEvent | WheelEvent) =>
      event.target instanceof HTMLCanvasElement &&
      latest.current.canStartGesture(event.clientX, event.clientY);
    const changeZoom = (value: number) => {
      const next = clampBoardZoom(value);
      latest.current.onZoom?.(next);
      latest.current.zoom = next;
    };
    const distance = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const capture = (pointerId: number) => {
      if (element.hasPointerCapture(pointerId)) return;
      try {
        element.setPointerCapture(pointerId);
      } catch {
        // A cancelled pointer may already have left the document.
      }
    };
    const down = (event: PointerEvent) => {
      if (pointers.size === 0) dragged = false;
      if (
        !active() ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        !onBoard(event)
      )
        return;
      // A plain tile click preserves the tool focus restored after inspection.
      event.preventDefault();
      const point = { x: event.clientX, y: event.clientY };
      pointers.set(event.pointerId, point);
      if (pointers.size === 1) {
        start = point;
        last = point;
        dragged = false;
        panGesture = event.shiftKey;
        element.dataset.boardDragging = "false";
      } else if (pointers.size === 2) {
        dragged = true;
        element.dataset.boardDragging = "true";
        pinch = {
          distance: Math.max(1, distance()),
          zoom: latest.current.zoom,
        };
        for (const pointerId of pointers.keys()) capture(pointerId);
      }
    };
    const move = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) {
        hovered = onBoard(event);
        return;
      }
      if (!active()) {
        pointers.clear();
        pinch = null;
        element.dataset.boardDragging = "false";
        return;
      }
      const point = { x: event.clientX, y: event.clientY };
      pointers.set(event.pointerId, point);
      if (pointers.size >= 2 && pinch) {
        changeZoom((pinch.zoom * distance()) / pinch.distance);
        event.preventDefault();
        return;
      }
      if (
        !dragged &&
        Math.hypot(point.x - start.x, point.y - start.y) >= BOARD_DRAG_THRESHOLD
      ) {
        element.focus({ preventScroll: true });
        dragged = true;
        element.dataset.boardDragging = "true";
        capture(event.pointerId);
      }
      if (dragged) {
        const dx = point.x - last.x;
        const dy = point.y - last.y;
        if (panGesture) {
          const { unitsPerPixel: units, limits: bounds } = latest.current;
          setPan((value) =>
            clampBoardPan(
              { x: value.x + dx * units, y: value.y - dy * units },
              bounds,
            ),
          );
        } else {
          const next = rotateBoardOrientation(
            latest.current.orientation,
            dx,
            dy,
          );
          latest.current.orientation = next;
          latest.current.onOrientation(next);
        }
        event.preventDefault();
      }
      last = point;
    };
    const up = (event: PointerEvent) => {
      // Transferring implicit canvas capture must not end an active touch.
      if (event.type === "lostpointercapture" && event.target !== element)
        return;
      pointers.delete(event.pointerId);
      if (element.hasPointerCapture(event.pointerId))
        element.releasePointerCapture(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) element.dataset.boardDragging = "false";
      const remaining = pointers.values().next().value;
      if (remaining) start = last = remaining;
    };
    const click = (event: MouseEvent) => {
      if (!dragged || event.detail === 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const wheel = (event: WheelEvent) => {
      if (
        !active() ||
        event.ctrlKey ||
        event.metaKey ||
        event.deltaY === 0 ||
        !onBoard(event)
      )
        return;
      event.preventDefault();
      changeZoom(
        latest.current.zoom - Math.sign(event.deltaY) * BOARD_ZOOM.step,
      );
    };
    const keydown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        !active() ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (target instanceof Element &&
          target.closest(
            "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
          ))
      )
        return;
      const focus = document.activeElement;
      if (focus !== element && !(hovered && focus === document.body)) return;
      if (event.key === "+" || event.key === "=")
        changeZoom(latest.current.zoom + BOARD_ZOOM.step);
      else if (event.key === "-")
        changeZoom(latest.current.zoom - BOARD_ZOOM.step);
      else if (event.key === "0") {
        changeZoom(BOARD_ZOOM.default);
        setPan(CENTERED_BOARD);
        latest.current.onOrientation(DEFAULT_BOARD_ORIENTATION);
      } else return;
      event.preventDefault();
    };
    const leave = () => {
      hovered = false;
    };
    element.addEventListener("pointerdown", down, true);
    element.addEventListener("pointermove", move, true);
    element.addEventListener("pointerup", up, true);
    element.addEventListener("pointercancel", up, true);
    element.addEventListener("lostpointercapture", up, true);
    element.addEventListener("click", click, true);
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("pointerleave", leave);
    window.addEventListener("keydown", keydown);
    return () => {
      element.dataset.boardDragging = "false";
      element.removeEventListener("pointerdown", down, true);
      element.removeEventListener("pointermove", move, true);
      element.removeEventListener("pointerup", up, true);
      element.removeEventListener("pointercancel", up, true);
      element.removeEventListener("lostpointercapture", up, true);
      element.removeEventListener("click", click, true);
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("pointerleave", leave);
      window.removeEventListener("keydown", keydown);
    };
  }, [layer]);
  return effectivePan;
}

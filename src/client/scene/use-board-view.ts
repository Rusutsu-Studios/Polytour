import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { BOARD_ZOOM, clampBoardZoom } from "../board-view.js";
import {
  type BoardPan,
  CENTERED_BOARD,
  clampBoardPan,
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
}: {
  layer: RefObject<HTMLElement | null>;
  enabled: boolean;
  zoom: number;
  onZoom?: (zoom: number) => void;
  resetKey?: number;
  limits: BoardPan;
  unitsPerPixel: number;
}) {
  const [pan, setPan] = useState(CENTERED_BOARD);
  const latest = useRef({ enabled, zoom, onZoom, limits, unitsPerPixel });
  latest.current = { enabled, zoom, onZoom, limits, unitsPerPixel };
  const effectivePan = useMemo(() => clampBoardPan(pan, limits), [pan, limits]);

  // A menu reset also recenters a previously dragged board.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key deliberately requests a fresh centered view.
  useEffect(() => setPan(CENTERED_BOARD), [resetKey]);
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
    let hovered = false;
    let pinch: { distance: number; zoom: number } | null = null;
    const active = () =>
      latest.current.enabled &&
      !Array.from(
        document.querySelectorAll(
          "dialog[open], [role='dialog'], [role='alertdialog']",
        ),
      ).some((dialog) => dialog.getClientRects().length > 0);
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
      if (!active() || event.button !== 0 || event.ctrlKey || event.metaKey)
        return;
      const point = { x: event.clientX, y: event.clientY };
      pointers.set(event.pointerId, point);
      if (pointers.size === 1) {
        start = point;
        last = point;
        dragged = false;
        element.dataset.boardDragging = "false";
        if (event.target instanceof HTMLCanvasElement)
          element.focus({ preventScroll: true });
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
      if (!pointers.has(event.pointerId)) return;
      if (!active()) {
        pointers.clear();
        pinch = null;
        return;
      }
      const point = { x: event.clientX, y: event.clientY };
      pointers.set(event.pointerId, point);
      if (pointers.size >= 2 && pinch) {
        changeZoom((pinch.zoom * distance()) / pinch.distance);
        event.preventDefault();
        return;
      }
      if (!dragged && Math.hypot(point.x - start.x, point.y - start.y) >= 5) {
        dragged = true;
        element.dataset.boardDragging = "true";
        capture(event.pointerId);
      }
      if (dragged) {
        const { unitsPerPixel: units, limits: bounds } = latest.current;
        const dx = (point.x - last.x) * units;
        const dy = -(point.y - last.y) * units;
        setPan((value) =>
          clampBoardPan({ x: value.x + dx, y: value.y + dy }, bounds),
        );
        event.preventDefault();
      }
      last = point;
    };
    const up = (event: PointerEvent) => {
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
      // Includes R3F tile clicks and the DOM quotes over forced-sale lots.
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const wheel = (event: WheelEvent) => {
      if (!active() || event.ctrlKey || event.metaKey || event.deltaY === 0)
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
      if (!element.contains(focus) && !(hovered && focus === document.body))
        return;
      if (event.key === "+" || event.key === "=") {
        changeZoom(latest.current.zoom + BOARD_ZOOM.step);
      } else if (event.key === "-") {
        changeZoom(latest.current.zoom - BOARD_ZOOM.step);
      } else if (event.key === "0") {
        changeZoom(BOARD_ZOOM.default);
        setPan(CENTERED_BOARD);
      } else return;
      event.preventDefault();
    };
    const enter = () => {
      hovered = true;
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
    element.addEventListener("pointerenter", enter);
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
      element.removeEventListener("pointerenter", enter);
      element.removeEventListener("pointerleave", leave);
      window.removeEventListener("keydown", keydown);
    };
  }, [layer]);
  return effectivePan;
}

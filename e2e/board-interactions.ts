import { expect, type Page } from "@playwright/test";
import { LOT_TOP, tilePoint } from "../src/client/scene/board-layout.js";

/** Project a board-local point through the mounted view and camera. */
export async function boardScreenPoint(
  page: Page,
  world: { x: number; y: number; z: number },
) {
  await expect(page.locator(".canvas-layer")).toHaveAttribute(
    "data-scene-ready",
    "true",
  );
  return page.evaluate(async (position) => {
    const modulePath = performance
      .getEntriesByType("resource")
      .find((entry) => entry.name.includes("/@react-three_fiber.js"))?.name;
    if (!modulePath) throw new Error("Expected the loaded R3F module");
    const { _roots } = (await import(
      modulePath
    )) as typeof import("@react-three/fiber");
    const canvas = document.querySelector<HTMLCanvasElement>(
      ".canvas-layer canvas",
    );
    const scene = canvas && _roots.get(canvas)?.store.getState();
    if (!canvas || !scene) throw new Error("Expected the mounted board");
    const spot = scene.camera.position
      .clone()
      .set(position.x, position.y, position.z);
    const view = scene.scene.getObjectByName("board-user-view");
    if (view) {
      view.updateWorldMatrix(true, false);
      spot.applyMatrix4(view.matrixWorld);
    }
    spot.project(scene.camera);
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.x + ((spot.x + 1) * rect.width) / 2,
      y: rect.y + ((1 - spot.y) * rect.height) / 2,
    };
  }, world);
}

/** Click the printed face using the mounted board's actual view. */
export async function clickBoardSpace(page: Page, tile: number) {
  const fallback = page.locator(".flat-board");
  if (await fallback.isVisible()) {
    await fallback.getByRole("button").nth(tile).click();
    return;
  }
  // Stay clear of the building band, pawns and corner landmarks.
  const [x, z] = tilePoint(tile, 0, -0.35);
  const point = await boardScreenPoint(page, { x, y: LOT_TOP + 0.003, z });
  await page.mouse.click(point.x, point.y);
}

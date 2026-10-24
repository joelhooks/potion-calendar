import type { BrowserWindow, Point, Rectangle } from "electron";

export const promptTopMargin = 8;

type WindowSize = Pick<Rectangle, "width" | "height">;

type PlacementWindow = Pick<
  BrowserWindow,
  "getBounds" | "isVisible" | "setPosition" | "setSize" | "showInactive"
>;

export interface PromptPlacementScreen {
  readonly getCursorScreenPoint: () => Point;
  readonly getDisplayNearestPoint: (point: Point) => {
    readonly workArea: Rectangle;
  };
  readonly getPrimaryDisplay: () => { readonly workArea: Rectangle };
}

export const promptPlacement = (area: Rectangle, size: WindowSize): Point => ({
  x: area.x + Math.max(0, Math.round((area.width - size.width) / 2)),
  y: area.y + Math.min(promptTopMargin, Math.max(0, area.height - size.height)),
});

const revealArea = (displays: PromptPlacementScreen): Rectangle => {
  try {
    return displays.getDisplayNearestPoint(displays.getCursorScreenPoint())
      .workArea;
  } catch {
    return displays.getPrimaryDisplay().workArea;
  }
};

export const resizePromptWindow = (
  window: Pick<PlacementWindow, "getBounds" | "setSize" | "setPosition">,
  height: number,
  area: Rectangle
): void => {
  window.setSize(380, height);
  const bounds = window.getBounds();
  const bottom = area.y + area.height;

  if (bounds.y + bounds.height > bottom) {
    window.setPosition(bounds.x, Math.max(area.y, bottom - bounds.height));
  }
};

export const revealPromptWindow = (
  window: PlacementWindow,
  displays: PromptPlacementScreen
): void => {
  if (!window.isVisible()) {
    const area = revealArea(displays);
    const bounds = window.getBounds();
    const height = Math.min(bounds.height, area.height);

    if (height !== bounds.height) {
      window.setSize(bounds.width, height);
    }

    const position = promptPlacement(area, { ...bounds, height });
    window.setPosition(position.x, position.y);
  }

  window.showInactive();
};

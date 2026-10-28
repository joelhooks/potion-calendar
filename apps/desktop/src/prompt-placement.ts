import type { PromptPlacement } from "@calendar/core/desktop-bridge";
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

export const promptWorkArea = (
  displays: PromptPlacementScreen,
  placement?: typeof PromptPlacement.Type
): Rectangle => {
  if (placement?.display === "primary") {
    return displays.getPrimaryDisplay().workArea;
  }

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

export const positionPromptWindow = (
  window: Pick<PlacementWindow, "getBounds" | "setSize" | "setPosition">,
  displays: PromptPlacementScreen,
  placement?: typeof PromptPlacement.Type
): void => {
  const area = promptWorkArea(displays, placement);
  const bounds = window.getBounds();
  const height = Math.min(bounds.height, area.height);

  if (height !== bounds.height) {
    window.setSize(bounds.width, height);
  }

  const position = promptPlacement(area, { ...bounds, height });
  window.setPosition(position.x, position.y);
};

export const revealPromptWindow = (
  window: PlacementWindow,
  displays: PromptPlacementScreen,
  placement?: typeof PromptPlacement.Type
): void => {
  if (!window.isVisible()) {
    positionPromptWindow(window, displays, placement);
  }

  window.showInactive();
};

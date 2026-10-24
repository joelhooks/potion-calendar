import type { PromptSize } from "@calendar/core/desktop-bridge";

export const promptFallbackHeight = (cards: number, workAreaHeight: number) =>
  Math.min(workAreaHeight, Math.max(140, 70 + cards * 100));

export const promptMeasuredHeight = (
  report: typeof PromptSize.Type,
  revision: number,
  currentHeight: number,
  workAreaHeight: number,
  frameHeight = 0
): number | undefined => {
  if (report.revision !== revision || !Number.isFinite(report.height)) {
    return undefined;
  }

  const height = Math.min(
    workAreaHeight,
    Math.max(140, Math.ceil(report.height)) + Math.max(0, frameHeight)
  );

  return height === currentHeight ? undefined : height;
};

export type TimedContentSurface = "chip" | "preview";

export interface TimedContent {
  readonly budget: number;
  readonly compact: boolean;
  readonly style: Readonly<Record<string, string>>;
}

export const timedContent = (
  height: number,
  surface: TimedContentSurface
): TimedContent => {
  const border = surface === "chip" ? 1 : 2;
  const padding = surface === "chip" ? 2 : 3;
  const gap = surface === "chip" ? 1 : 0;
  const line = 14;
  const budget = line * 2 + gap + (padding + border) * 2;
  const compact = height < budget;

  return {
    budget,
    compact,
    style: {
      "--timed-border": `${border}px`,
      "--timed-gap": compact ? "min(4px, 4%)" : `${gap}px`,
      "--timed-line": `${compact && surface === "preview" ? 12 : line}px`,
      "--timed-padding": `${compact ? 0 : padding}px`,
      "--timed-stack-gap": `${gap}px`,
      "--timed-stack-line": `${line}px`,
      "--timed-stack-padding": `${padding}px`,
    },
  };
};

export const timeAreaHeight = (viewport: HTMLElement): number =>
  Math.max(
    0,
    viewport.clientHeight -
      (viewport.querySelector<HTMLElement>(".day-headers")?.offsetHeight ?? 0) -
      (viewport.querySelector<HTMLElement>(".all-day-stack")?.offsetHeight ?? 0)
  );

export const todayScrollLeft = (viewport: HTMLElement): number => {
  const today = viewport.querySelector<HTMLElement>(".today-column");
  const columns = viewport.querySelector<HTMLElement>(".day-columns");

  if (today === null || columns === null) {
    return viewport.scrollLeft;
  }

  const frame = viewport.getBoundingClientRect();
  const day = today.getBoundingClientRect();

  const gutters =
    columns.getBoundingClientRect().left - frame.left + viewport.scrollLeft;

  const left = frame.left + gutters;
  const right = frame.left + viewport.clientWidth;

  if (day.left < left) {
    return Math.max(0, viewport.scrollLeft + day.left - left);
  }

  return day.right > right
    ? viewport.scrollLeft + day.right - right
    : viewport.scrollLeft;
};

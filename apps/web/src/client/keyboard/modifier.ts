export const platformModifier = (
  event: Readonly<{ ctrlKey: boolean; metaKey: boolean }>,
  platform: string = navigator.platform
): boolean =>
  /Mac|iPhone|iPad/u.test(platform) ? event.metaKey : event.ctrlKey;

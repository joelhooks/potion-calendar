export const acceptsDesktopFrame = (
  origin: string,
  url: string,
  mainFrame: boolean
): boolean => mainFrame && URL.parse(url)?.origin === origin;

export const desktopPermission = (
  permission: string,
  origin: string,
  requestingUrl: string,
  mainFrame: boolean
): boolean =>
  permission === "notifications" &&
  acceptsDesktopFrame(origin, requestingUrl, mainFrame);

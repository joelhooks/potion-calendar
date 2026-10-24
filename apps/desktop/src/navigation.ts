export { navigation } from "@calendar/core/desktop-bridge";

export type { Navigation } from "@calendar/core/desktop-bridge";

export const startsSystemSignIn = (
  target: string,
  origin: string,
  packaged: boolean
) => {
  const url = URL.parse(target);

  return (
    url !== null &&
    ((url.protocol === "https:" &&
      url.hostname === "accounts.google.com" &&
      url.pathname === "/o/oauth2/v2/auth") ||
      (!packaged &&
        url.origin === origin &&
        url.pathname === "/__fake-google/authorize"))
  );
};

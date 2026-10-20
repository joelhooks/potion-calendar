export type Navigation = "window" | "browser" | "deny";

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

export const navigation = (target: string, origin: string): Navigation => {
  const url = URL.parse(target);

  if (url === null || url.username !== "" || url.password !== "") {
    return "deny";
  }

  if (
    url.origin === origin &&
    (url.protocol === "https:" || url.protocol === "http:")
  ) {
    return "window";
  }

  return url.protocol === "https:" || url.protocol === "mailto:"
    ? "browser"
    : "deny";
};

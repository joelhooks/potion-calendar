export const authNavigation = (cookieNames: readonly string[]) =>
  cookieNames.some((name) =>
    [
      "better-auth.session_token",
      "__Secure-better-auth.session_token",
    ].includes(name)
  )
    ? "browserAccount"
    : "signIn";

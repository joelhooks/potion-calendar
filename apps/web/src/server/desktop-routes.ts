import { desktopHandoffStore } from "@calendar/auth/desktop";
import { createGoogleAuth } from "@calendar/auth/google";
import type {
  GoogleAuth,
  GoogleAuthConfig,
  GoogleProvider,
} from "@calendar/auth/google";
import type { D1Database } from "@cloudflare/workers-types";
import { Option, Schema } from "effect";

const Handoff = Schema.Struct({
  port: Schema.NumberFromString.check(
    Schema.isInt(),
    Schema.isBetween({ maximum: 65_535, minimum: 1024 })
  ),
  state: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
});

const Token = Schema.Struct({
  token: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
});

const Location = Schema.Struct({ url: Schema.String });

const headers = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow",
};

const refused = () =>
  new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8"><title>Sign-in failed</title><h1>Sign-in failed</h1><p>This sign-in expired or was refused. Return to Potion Calendar and choose Sign In to try again.</p><a href="/">Try again</a></html>',
    { headers, status: 400 }
  );

// @effect-diagnostics-next-line asyncFunction:off -- Better Auth sets its own signed session cookie before this protocol redirects to the calendar.
const completeSignIn = async (
  request: Request,
  config: GoogleAuthConfig,
  auth: GoogleAuth
) => {
  const url = new URL(request.url);

  if (url.searchParams.getAll("token").length !== 1) {
    return refused();
  }

  const redeem = new URL("/auth/desktop/redeem", config.baseURL);
  redeem.searchParams.set("token", url.searchParams.get("token") ?? "");

  const response = await auth.handler(
    new Request(redeem, { headers: request.headers })
  );

  if (!response.ok) {
    return refused();
  }

  const result = new Headers(headers);
  result.set("location", "/");

  for (const cookie of response.headers.getSetCookie()) {
    result.append("set-cookie", cookie);
  }

  return new Response(null, { headers: result, status: 303 });
};

// @effect-diagnostics-next-line asyncFunction:off -- The desktop OAuth handoff is an external HTTP protocol boundary, not an application capability.
export const desktopRoutesWithAuth = async (
  request: Request,
  config: GoogleAuthConfig,
  auth: GoogleAuth
): Promise<Response> => {
  const url = new URL(request.url);

  if (url.origin !== config.baseURL) {
    return refused();
  }

  if (url.pathname === "/desktop/browser-account" && request.method === "GET") {
    return new Response(
      '<!doctype html><html lang="en"><meta charset="utf-8"><title>Finish in your browser</title><h1>Finish in your browser</h1><p>Finish adding or reconnecting the account in your browser, then come back here.</p><p>The calendar reloads when this window regains focus.</p><a href="/">Return to calendar</a></html>',
      { headers }
    );
  }

  if (url.pathname === "/desktop/complete" && request.method === "GET") {
    return await completeSignIn(request, config, auth);
  }

  if (
    url.pathname !== "/desktop/sign-in" ||
    (request.method !== "GET" && request.method !== "POST") ||
    url.searchParams.getAll("port").length !== 1 ||
    url.searchParams.getAll("state").length !== 1
  ) {
    return refused();
  }

  const input = Schema.decodeUnknownOption(Handoff)({
    port: url.searchParams.get("port"),
    state: url.searchParams.get("state"),
  });

  if (Option.isNone(input)) {
    return refused();
  }

  const current = await auth.api.getSession({ headers: request.headers });

  if (current === null) {
    if (request.method !== "GET") {
      return refused();
    }

    const response = await auth.handler(
      new Request(`${config.baseURL}/auth/sign-in/oauth2`, {
        body: JSON.stringify({
          callbackURL: url.href,
          errorCallbackURL: "/refused",
          providerId: "google",
        }),
        headers: {
          "content-type": "application/json",
          cookie: request.headers.get("cookie") ?? "",
          origin: config.baseURL,
        },
        method: "POST",
      })
    );

    if (!response.ok) {
      return refused();
    }

    const location = Schema.decodeUnknownSync(Location)(await response.json());
    const result = new Headers(headers);
    result.set("location", location.url);

    for (const cookie of response.headers.getSetCookie()) {
      result.append("set-cookie", cookie);
    }

    return new Response(null, { headers: result, status: 303 });
  }

  if (request.method === "GET") {
    return new Response(
      '<!doctype html><html lang="en"><meta charset="utf-8"><title>Potion Calendar sign-in</title><h1>Sign in to Potion Calendar</h1><p>Continue only if you opened Potion Calendar on this Mac.</p><form method="post"><button>Continue to Potion Calendar</button></form></html>',
      { headers }
    );
  }

  if (request.headers.get("origin") !== config.baseURL) {
    return refused();
  }

  const response = await auth.handler(
    new Request(`${config.baseURL}/auth/desktop/issue`, {
      headers: request.headers,
    })
  );

  if (!response.ok) {
    return refused();
  }

  const issued = Schema.decodeUnknownSync(Token)(await response.json());
  const callback = new URL(`http://127.0.0.1:${input.value.port}/callback`);
  callback.searchParams.set("token", issued.token);
  callback.searchParams.set("state", input.value.state);

  return new Response(null, {
    headers: { ...headers, location: callback.href },
    status: 303,
  });
};

// @effect-diagnostics-next-line asyncFunction:off -- Production and local development share this request-local Better Auth composition.
export const desktopRoutes = async (
  request: Request,
  config: GoogleAuthConfig,
  database: D1Database,
  provider?: GoogleProvider
) =>
  await desktopRoutesWithAuth(
    request,
    config,
    createGoogleAuth(
      { ...config, desktopStore: desktopHandoffStore(database) },
      database,
      provider
    )
  );

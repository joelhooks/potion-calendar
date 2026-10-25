import { allowedEmail, createGoogleAuth } from "@calendar/auth/google";
import type { GoogleAuthConfig } from "@calendar/auth/google";
import { Provider } from "@calendar/calendar";
import { expireCalendarRanges } from "@calendar/database/calendar-cache";
import { googlePushRepository } from "@calendar/database/google-push";
import { Effect, Result } from "effect";

import { createBackend } from "./backend.js";
import { serveCalendarAsset } from "./calendar-assets.js";
import { syncConnectedCalendars } from "./calendar-cron.js";
import type { CalendarEnvironment } from "./calendar-environment.js";
import { calendarAuthConfig } from "./calendar-origin.js";
import type { CalendarOriginPolicy } from "./calendar-origin.js";
import { desktopRoutes } from "./desktop-routes.js";
import { receiveGooglePush } from "./google-push-webhook.js";
import { calendarLiveClient, liveCalendarOptions } from "./live-client.js";

const isRpcPath = (path: string) => path === "/rpc" || path === "/rpc/";

const isAuthOrRpcPath = (path: string) =>
  path.startsWith("/auth/") || isRpcPath(path);

const sameOriginRpcRequest = (headers: Headers, configuredOrigin: string) => {
  const origin = headers.get("origin");
  const fetchSite = headers.get("sec-fetch-site");

  return (
    origin === configuredOrigin &&
    (fetchSite === null || fetchSite === "same-origin")
  );
};

// @effect-diagnostics-next-line asyncFunction:off -- Cloudflare's socket upgrade exchanges native Response and WebSocket values.
const upgradeLiveSocket = async (
  request: Request,
  environment: CalendarEnvironment,
  config: GoogleAuthConfig
): Promise<Response> => {
  if (
    request.method !== "GET" ||
    request.headers.get("upgrade")?.toLowerCase() !== "websocket"
  ) {
    return new Response(null, { status: 426 });
  }

  const auth = createGoogleAuth(config, environment.DB);
  const current = await auth.api.getSession({ headers: request.headers });

  if (
    current === null ||
    !allowedEmail(current.user.email, config.allowedEmails)
  ) {
    return new Response(null, { status: 401 });
  }

  if (request.headers.get("origin") !== config.baseURL) {
    return new Response(null, { status: 403 });
  }

  const response = await Effect.runPromise(
    calendarLiveClient(environment.CALENDAR_LIVE).upgrade(
      current.user.id,
      config.baseURL
    )
  );

  if (response.status !== 101 || response.webSocket === null) {
    return new Response(null, { status: 503 });
  }

  const upgrade = { status: 101, webSocket: response.webSocket };

  return new Response(null, upgrade);
};

export const calendarWorker = (
  policy: CalendarOriginPolicy = "production"
) => ({
  // @effect-diagnostics-next-line asyncFunction:off -- Cloudflare invokes the fetch boundary through a native Promise with Worker bindings.
  async fetch(
    request: Request,
    environment: CalendarEnvironment
  ): Promise<Response> {
    const url = new URL(request.url);

    const headers = {
      "cache-control": "no-store",
      "x-content-generation": environment.RELEASE,
      "x-robots-tag": "noindex, nofollow",
    };

    const parsed = await Effect.runPromise(
      calendarAuthConfig(environment, policy).pipe(Effect.result)
    );

    if (Result.isFailure(parsed) || parsed.success.baseURL !== url.origin) {
      return new Response("Unavailable", { headers, status: 503 });
    }

    const live = calendarLiveClient(environment.CALENDAR_LIVE);

    const config = {
      ...parsed.success,
      // @effect-diagnostics-next-line asyncFunction:off -- Better Auth invokes account cleanup through a native Promise callback.
      beforeAccountDelete: async (personId: string, accountId: string) => {
        await Effect.runPromise(live.stopAccount(personId, accountId));
      },
    };

    if (url.pathname.startsWith("/desktop/")) {
      return await desktopRoutes(request, config, environment.DB);
    }

    if (url.pathname === "/google/push") {
      const outcome = await Effect.runPromise(
        receiveGooglePush(
          request,
          config.allowedEmails,
          googlePushRepository(environment.DB),
          (channel, number, removed) =>
            live.enqueue(channel, number, removed).pipe(Effect.asVoid)
        ).pipe(
          Effect.tapError((error) =>
            Effect.logWarning("Google push unavailable", {
              operation: error.operation,
              status: error.status,
            })
          ),
          Effect.result
        )
      );

      return Result.isFailure(outcome)
        ? new Response(null, { headers, status: 503 })
        : new Response(null, { headers, status: outcome.success.status });
    }

    if (url.pathname === "/refused") {
      return new Response(
        "This Google account is not allowed to use Calendar. Sign in with an allowed account.",
        { headers, status: 403 }
      );
    }

    if (
      url.pathname.startsWith("/__fake-google/") ||
      url.pathname.startsWith("/__rat/")
    ) {
      return new Response("Not found", { headers, status: 404 });
    }

    if (url.pathname === "/live") {
      return await upgradeLiveSocket(request, environment, config);
    }

    const rpcRequest = isRpcPath(url.pathname);

    if (rpcRequest && !sameOriginRpcRequest(request.headers, config.baseURL)) {
      return new Response(null, { headers, status: 403 });
    }

    if (isAuthOrRpcPath(url.pathname)) {
      const auth = createGoogleAuth(config, environment.DB);

      if (url.pathname.startsWith("/auth/")) {
        const response = await auth.handler(request);
        const responseHeaders = new Headers(response.headers);

        for (const [name, value] of Object.entries(headers)) {
          responseHeaders.set(name, value);
        }

        return new Response(response.body, {
          headers: responseHeaders,
          status: response.status,
        });
      }

      const rpc = createBackend(
        auth,
        config,
        request.headers,
        liveCalendarOptions(environment)
      );

      try {
        const response = await rpc.handler(request);

        return new Response(response.body, {
          headers: new Headers([
            ...response.headers,
            ...Object.entries(headers),
          ]),
          status: response.status,
        });
      } finally {
        await rpc.dispose();
      }
    }

    return await serveCalendarAsset(
      request,
      environment.ASSETS,
      new Headers(headers)
    );
  },
  // @effect-diagnostics-next-line asyncFunction:off -- Cloudflare invokes scheduled events through its native Promise boundary.
  async scheduled(
    _event: { readonly cron: string; readonly scheduledTime: number },
    environment: CalendarEnvironment
  ): Promise<void> {
    const config = await Effect.runPromise(
      calendarAuthConfig(environment, policy)
    );

    const auth = createGoogleAuth(config, environment.DB);

    await Effect.runPromise(
      Effect.gen(function* calendarSafetyNet() {
        const expired = yield* expireCalendarRanges(environment.DB);

        const summary = yield* syncConnectedCalendars(
          auth,
          config,
          liveCalendarOptions(environment)
        );

        yield* Effect.logInfo("Calendar safety-net sync", {
          ...summary,
          expired,
        });

        return yield* summary.failed > 0
          ? Effect.fail(
              new Provider({
                message: "Calendar safety-net sync did not complete",
                operation: "cron",
                status: 0,
              })
            )
          : Effect.void;
      })
    );
  },
});

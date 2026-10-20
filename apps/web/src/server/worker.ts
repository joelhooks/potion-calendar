import { createGoogleAuth } from "@calendar/auth/google";
import { Provider } from "@calendar/calendar";
import { expireCalendarRanges } from "@calendar/database/calendar-cache";
import { Effect } from "effect";

import { createBackend } from "./backend.js";
import { syncConnectedCalendars } from "./calendar-cron.js";
import { d1CalendarStore } from "./calendar-store.js";

export interface CalendarEnvironment {
  readonly ALLOWED_EMAILS: string;
  readonly BETTER_AUTH_SECRET: string;
  readonly DB: Parameters<typeof d1CalendarStore>[0];
  readonly GOOGLE_CLIENT_ID: string;
  readonly GOOGLE_CLIENT_SECRET: string;
  readonly RELEASE: string;
  readonly ASSETS: { readonly fetch: (request: Request) => Promise<Response> };
}

const configFor = (environment: CalendarEnvironment) => ({
  allowedEmails: environment.ALLOWED_EMAILS,
  baseURL: "https://calendar.wzrrd.sh",
  clientId: environment.GOOGLE_CLIENT_ID,
  clientSecret: environment.GOOGLE_CLIENT_SECRET,
  secret: environment.BETTER_AUTH_SECRET,
});

export default {
  // @effect-diagnostics-next-line asyncFunction:off -- Cloudflare invokes the Web fetch boundary with native bindings.
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

    const config = configFor(environment);

    if (
      url.pathname.startsWith("/auth/") ||
      url.pathname === "/rpc" ||
      url.pathname === "/rpc/"
    ) {
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

      const rpc = createBackend(auth, config, request.headers, {
        storeFor: (personId) => d1CalendarStore(environment.DB, personId),
      });

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

    if (url.pathname !== "/" && !url.pathname.startsWith("/assets/")) {
      return new Response("Not found", { headers, status: 404 });
    }

    const response = await environment.ASSETS.fetch(request);

    return new Response(response.body, {
      headers: new Headers([...response.headers, ...Object.entries(headers)]),
      status: response.status,
    });
  },
  // @effect-diagnostics-next-line asyncFunction:off -- Cloudflare invokes scheduled events through a native Promise boundary.
  async scheduled(
    _event: { readonly cron: string; readonly scheduledTime: number },
    environment: CalendarEnvironment
  ): Promise<void> {
    const config = configFor(environment);
    const auth = createGoogleAuth(config, environment.DB);

    await Effect.runPromise(
      Effect.gen(function* calendarSafetyNet() {
        const expired = yield* expireCalendarRanges(environment.DB);

        const summary = yield* syncConnectedCalendars(auth, config, {
          storeFor: (personId) => d1CalendarStore(environment.DB, personId),
        });

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
};

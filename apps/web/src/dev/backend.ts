import { createFakeAuth } from "@calendar/auth/dev/fake-google";
import { googleTokensFor } from "@calendar/auth/google-tokens";
import { CalendarStore } from "@calendar/calendar";
import { memoryCalendarStore } from "@calendar/calendar/memory";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";

import { createBackend } from "../server/backend.js";
import { fakeCalendarGoogle } from "./calendar-google.js";
import { seedFakePerson } from "./person.js";

export const makeDevelopmentBackend = (origin: string) => {
  const fake = createFakeAuth(origin);

  const fixture = Effect.runPromise(
    Effect.gen(function* developmentFixture() {
      const person = yield* seedFakePerson(fake);

      const tokens = yield* googleTokensFor(
        fake.auth,
        person.personId,
        fake.config
      );

      const googleHttp = yield* fakeCalendarGoogle(yield* tokens.accounts());
      const context = yield* Layer.build(memoryCalendarStore);
      const store = yield* CalendarStore.pipe(Effect.provideContext(context));

      return {
        ...person,
        googleHttp,
        storeFor: () => Layer.succeed(CalendarStore, store),
      };
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer))
  );

  // @effect-diagnostics-next-line asyncFunction:off -- Vite's middleware consumes Web request Promises.
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    if (url.pathname === "/__fake-google/token") {
      const input = new URLSearchParams(await request.text());

      const validClient =
        request.method === "POST" &&
        input.get("client_id") === fake.config.clientId &&
        input.get("client_secret") === fake.config.clientSecret &&
        input.get("grant_type") === "refresh_token";

      const tokens = validClient
        ? fake.refresh(input.get("refresh_token") ?? "")
        : null;

      return tokens === null
        ? Response.json({ error: "invalid_grant" }, { status: 400 })
        : Response.json(tokens);
    }

    if (url.pathname === "/__fake-google/authorize") {
      const email = url.searchParams.get("email");

      if (email !== null) {
        return Response.redirect(fake.authorize(url, email), 302);
      }

      return new Response(
        `<!doctype html><html lang="en"><meta charset="utf-8"><title>Local Google</title><h1>Development Google account</h1><p>No Google connection is made.</p><form method="get"><select name="email"><option>joel@example.test</option><option>second@example.test</option><option>refused@example.test</option></select><button>Continue</button></form><script>for(const [name,value] of new URLSearchParams(location.search)){const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;document.querySelector('form').append(input)}</script></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } }
      );
    }

    if (url.pathname.startsWith("/auth/")) {
      return await fake.auth.handler(request);
    }

    if (url.pathname === "/refused") {
      return new Response(
        "This Google account is not allowed to use Calendar. Sign in with an allowed account.",
        { status: 403 }
      );
    }

    const seeded = await fixture;
    const headers = new Headers(request.headers);
    const bootstrap = !headers.has("cookie");

    if (bootstrap) {
      headers.set("cookie", seeded.cookie);
    }

    const rpc = createBackend(fake.auth, fake.config, headers, seeded);

    try {
      const response = await rpc.handler(request);

      if (!bootstrap) {
        return response;
      }

      const responseHeaders = new Headers(response.headers);
      const secure = url.protocol === "https:" ? "; Secure" : "";

      for (const cookie of seeded.cookie.split("; ")) {
        responseHeaders.append(
          "set-cookie",
          `${cookie}; Path=/; HttpOnly; SameSite=Lax${secure}`
        );
      }

      return new Response(response.body, {
        headers: responseHeaders,
        status: response.status,
      });
    } finally {
      await rpc.dispose();
    }
  };
};

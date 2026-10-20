import type { createFakeAuth } from "@calendar/auth/dev/fake-google";
import { Effect, Schema } from "effect";

const Authorization = Schema.Struct({ url: Schema.String });

const cookiesFor = (response: Response, previous = "") => {
  const cookies = new Map(
    previous
      .split("; ")
      .filter(Boolean)
      .map((entry) => {
        const index = entry.indexOf("=");

        return [entry.slice(0, index), entry.slice(index + 1)];
      })
  );

  for (const cookie of response.headers.getSetCookie()) {
    const entry = cookie.split(";")[0] ?? "";
    const index = entry.indexOf("=");
    const value = entry.slice(index + 1);

    if (value.length === 0) {
      cookies.delete(entry.slice(0, index));
    } else {
      cookies.set(entry.slice(0, index), value);
    }
  }

  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
};

export const seedFakePerson = Effect.fn("seedFakePerson")(
  function* seedFakePerson(
    fake: ReturnType<typeof createFakeAuth>,
    emails: readonly string[] = ["joel@example.test", "second@example.test"],
    initialSession?: { readonly cookie: string }
  ) {
    let cookie = initialSession?.cookie ?? "";

    for (const email of emails) {
      const start = yield* Effect.promise(
        fake.auth.handler.bind(
          fake.auth,
          new Request(
            `${fake.config.baseURL}/auth/${cookie === "" ? "sign-in/oauth2" : "oauth2/link"}`,
            {
              body: JSON.stringify({ callbackURL: "/", providerId: "google" }),
              headers: {
                "content-type": "application/json",
                cookie,
                origin: fake.config.baseURL,
              },
              method: "POST",
            }
          )
        )
      );

      const body: unknown = yield* Effect.promise(start.json.bind(start));

      const authorization =
        yield* Schema.decodeUnknownEffect(Authorization)(body);

      const callback = fake.authorize(new URL(authorization.url), email);

      const response = yield* Effect.promise(
        fake.auth.handler.bind(
          fake.auth,
          new Request(callback, {
            headers: { cookie: cookiesFor(start, cookie) },
          })
        )
      );

      if (response.status !== 302 || response.headers.get("location") !== "/") {
        return yield* Effect.die(
          new Error("Development Google fixture could not sign in")
        );
      }

      cookie = cookiesFor(response, cookiesFor(start, cookie));
    }

    const current = yield* Effect.promise(
      fake.auth.api.getSession.bind(fake.auth.api, {
        headers: new Headers({ cookie }),
      })
    );

    if (current === null) {
      return yield* Effect.die(new Error("Development person has no session"));
    }

    return { cookie, personId: current.user.id };
  }
);

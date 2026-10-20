import { Provider } from "@calendar/calendar";
import { Effect, Schema } from "effect";

import type { CalendarEnvironment } from "./calendar-environment.js";

export type CalendarOriginPolicy = "production" | "development";

const invalid = () =>
  new Provider({
    message: "Calendar origin binding is invalid",
    operation: "startup",
    status: 503,
  });

export const calendarOrigin = Effect.fn("calendarOrigin")(
  function* calendarOrigin(value: string, policy: CalendarOriginPolicy) {
    const url = yield* Schema.decodeEffect(Schema.URLFromString)(value).pipe(
      Effect.mapError(invalid)
    );

    const loopback =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]" ||
      url.hostname.endsWith(".localhost");

    if (
      value !== url.origin ||
      (policy === "production" && url.protocol !== "https:") ||
      (policy === "development" &&
        (!loopback || !["http:", "https:"].includes(url.protocol)))
    ) {
      return yield* invalid();
    }

    return url.origin;
  }
);

export const calendarAuthConfig = Effect.fn("calendarAuthConfig")(
  function* calendarAuthConfig(
    environment: CalendarEnvironment,
    policy: CalendarOriginPolicy
  ) {
    return {
      allowedEmails: environment.ALLOWED_EMAILS,
      baseURL: yield* calendarOrigin(environment.CALENDAR_ORIGIN, policy),
      clientId: environment.GOOGLE_CLIENT_ID,
      clientSecret: environment.GOOGLE_CLIENT_SECRET,
      secret: environment.BETTER_AUTH_SECRET,
    };
  }
);

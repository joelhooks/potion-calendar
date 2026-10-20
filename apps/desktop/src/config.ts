import { Effect, Schema } from "effect";

import application from "./application.json" with { type: "json" };

export class DesktopError extends Schema.TaggedError<DesktopError>()(
  "DesktopError",
  { cause: Schema.optional(Schema.Defect()), message: Schema.String }
) {}

export const desktopOrigin = (packaged: boolean, configured?: string) => {
  const url = URL.parse(configured ?? application.origin);

  const loopback =
    url !== null &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]" ||
      url.hostname.endsWith(".localhost"));

  if (
    url === null ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    (packaged
      ? url.origin !== application.origin
      : url.origin !== application.origin &&
        (!loopback || !["http:", "https:"].includes(url.protocol)))
  ) {
    return Effect.fail(
      new DesktopError({ message: "Desktop origin is not permitted" })
    );
  }

  return Effect.succeed(url.origin);
};

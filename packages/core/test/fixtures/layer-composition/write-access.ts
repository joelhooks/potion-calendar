import { Context, Effect, Layer } from "effect";

import { Resource } from "./resource.js";

export class WriteAccess extends Context.Service<WriteAccess, number>()(
  "@calendar/core/test/WriteAccess"
) {
  static readonly layer = Layer.effect(
    this,
    Resource.pipe(Effect.map((resource) => resource.id))
  );
}

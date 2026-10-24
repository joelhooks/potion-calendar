import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { autoTypeConversion } from "../src/client/editing/type-conversion.js";
import { conversionActor } from "./type-conversion-fixture.js";

it.effect(
  "an offered empty primary creation draft qualifies for a title conversion",
  () =>
    Effect.gen(function* availability() {
      const actor = yield* conversionActor();
      const { session } = actor.getSnapshot().context;
      expect(session).toBeDefined();

      if (session === undefined) {
        return;
      }

      const result = yield* autoTypeConversion({
        ...session,
        draft: { ...session.draft, title: "Focus" },
      });

      expect(Option.getOrUndefined(result)?.draft.eventType).toBe("focusTime");
    }).pipe(Effect.provide(NodeServices.layer))
);

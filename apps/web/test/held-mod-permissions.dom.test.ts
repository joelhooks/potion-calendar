import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Ref } from "effect";

import { Message } from "../src/client/app.js";
import { EditingNotice } from "../src/client/editing/runtime.js";
import { heldModNativeGesture } from "./held-mod-native-fixture.js";
import { heldModRuntimeFixture } from "./held-mod-runtime-fixture.js";
import {
  instantRuntimeFixture,
  nextInstantNotice,
} from "./instant-runtime-fixture.js";

it.effect.each(["outOfOffice", "lostPermission"] as const)(
  "held Mod cannot bypass authoritative %s refusal",
  (reason) =>
    Effect.gen(function* authoritativeGestureRefusal() {
      const h = yield* instantRuntimeFixture({
        authoritativeModifiable: reason !== "lostPermission",
        eventType: reason === "outOfOffice" ? "outOfOffice" : "default",
        modifiable: true,
        operation: "save",
        organizer: reason !== "lostPermission",
        recurring: false,
        undo: false,
      });

      const native = yield* heldModNativeGesture({
        downMod: true,
        dropMod: true,
        model: h.model,
        platform: "MacIntel",
        resize: true,
        shift: true,
      });

      const gesture = yield* Effect.fromNullishOr(native.completed);
      yield* h.dispatch(
        Message.CompletedGesture({
          gesture,
          hostKey: native.hostKey,
          personId: h.personId,
        })
      );

      const refused = yield* nextInstantNotice(
        h.queue,
        (notice) =>
          EditingNotice.guards.Editor(notice) && Option.isSome(notice.error)
      );

      expect(
        EditingNotice.guards.Editor(refused) && Option.isSome(refused.error)
      ).toBe(true);
      const requests = yield* Ref.get(h.api.fake.requests);
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.every((request) => request.method === "GET")).toBe(true);
      expect((yield* Ref.get(h.state)).editing.instantSaved).toEqual(
        Option.none()
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

it.effect(
  "an invitee with the existing modify grant can move with held Mod without email, but the receipt gives no additional permission",
  () =>
    Effect.gen(function* permittedInviteeMove() {
      const h = yield* heldModRuntimeFixture({
        modifiable: true,
        organizer: false,
        scenario: "week-move",
      });

      expect(
        h.saved?.plan.session.original.pipe(
          Option.map((source) => source.organizer?.self)
        )
      ).toEqual(Option.some(false));
      expect(h.saved?.plan.scope).toBe("single");
      expect(h.saved?.plan.sendUpdates).toBe("none");
      expect(h.views).not.toContain("Email");
      expect(h.views).not.toContain("Scope");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

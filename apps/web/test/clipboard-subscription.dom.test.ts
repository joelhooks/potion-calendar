import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema, Stream } from "effect";
import { AsyncData } from "foldkit";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import { ClipboardDelivery } from "../src/client/clipboard/delivery.js";
import { initialClipboardView } from "../src/client/clipboard/model.js";
import {
  ClipboardNotice,
  ClipboardRuntime,
} from "../src/client/clipboard/runtime.js";
import { clipboardStream } from "../src/client/clipboard/subscription.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionWriter } from "../src/client/editing/delete-actor.js";
import { subscriptions } from "../src/client/subscriptions.js";
import { clipboardGuestFixture } from "./clipboard-root-fixture.js";
import { clipboardClient } from "./clipboard-runtime-fixture.js";

it.effect(
  "the real clipboard subscription opens one person-bound native lease and releases all owned listeners when its scope ends",
  () =>
    Effect.gen(function* clipboardSubscriptionLifecycle() {
      const add = vi.spyOn(document, "addEventListener");
      const remove = vi.spyOn(document, "removeEventListener");
      const memory = clipboardClient(0);
      const model = clipboardGuestFixture();

      const first = yield* clipboardStream(model.person, 7, () => model).pipe(
        Stream.runHead,
        Effect.scoped,
        Effect.provide(ClipboardRuntime.layer),
        Effect.provideService(CalendarEditingClient, memory.client),
        Effect.provideService(
          DeletionWriter,
          DeletionWriter.of({
            commit: () => Effect.die("Subscription must not delete"),
          })
        )
      );

      expect(Option.isSome(first)).toBe(true);

      if (Option.isSome(first)) {
        expect(first.value.delivery).toMatchObject({
          epoch: 7,
          personId: "fixture-person",
        });
        expect(first.value.delivery.sessionId).not.toBe("clipboard-connection");
      }

      for (const event of [
        "copy",
        "cut",
        "paste",
        "compositionstart",
        "compositionend",
        "pointermove",
        "pointerdown",
        "pointerout",
      ]) {
        const registration = add.mock.calls.find(([kind]) => kind === event);
        expect(registration, event).toBeDefined();
        expect(
          remove.mock.calls.some(
            ([kind, listener]) =>
              kind === event && listener === registration?.[1]
          ),
          event
        ).toBe(true);
      }

      expect(memory.calls).toHaveLength(0);
      add.mockRestore();
      remove.mockRestore();
    }).pipe(Effect.provide(NodeServices.layer))
);

it("the mounted subscription retains a person epoch across view changes but replaces it across a round trip; same-person session refresh preserves owned UI", () => {
  const base = clipboardGuestFixture();
  const session = Option.getOrThrow(AsyncData.getData(base.session));

  if (session === null) {
    throw new Error("Fixture session missing");
  }

  const refresh = update(base, Message.ReceivedSession({ snapshot: session }));
  expect(refresh.model.clipboard).toBe(base.clipboard);

  const signedOut = update(
    base,
    Message.ReceivedSession({ snapshot: null })
  ).model;

  expect(signedOut.clipboard.epoch).toBe(base.clipboard.epoch + 1);
  expect(Option.isNone(signedOut.clipboard.sessionId)).toBe(true);

  const signedBack = update(
    signedOut,
    Message.ReceivedSession({ snapshot: session })
  ).model;

  expect(signedBack.clipboard.epoch).toBe(base.clipboard.epoch + 2);

  const old = update(
    signedBack,
    Message.ReceivedClipboard({
      delivery: ClipboardDelivery.make({
        epoch: base.clipboard.epoch,
        notice: ClipboardNotice.cases.State.make({
          view: initialClipboardView,
        }),
        personId: session.user.id,
        sessionId: "clipboard-connection",
      }),
    })
  );

  expect(old.model.clipboard).toBe(signedBack.clipboard);
  const entry = subscriptions.clipboard;

  const equal =
    entry.keepAliveEquivalence ??
    Schema.toEquivalence(entry.dependenciesSchema);

  expect(equal({ model: base }, { model: refresh.model })).toBe(true);
  expect(equal({ model: base }, { model: signedBack })).toBe(false);
});

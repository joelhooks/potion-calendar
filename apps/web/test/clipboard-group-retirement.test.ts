import { CalendarEvent } from "@calendar/calendar/contracts";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Option, Stream } from "effect";

import {
  ClipboardEnvelope,
  ClipboardView,
  NativeClipboardNotice,
} from "../src/client/clipboard/model.js";
import {
  ClipboardAction,
  ClipboardNotice,
  ClipboardRuntime,
} from "../src/client/clipboard/runtime.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionWriter } from "../src/client/editing/delete-actor.js";
import { clipboardItem } from "./clipboard-fixture.js";
import {
  clipboardClient,
  clipboardPoint,
  clipboardTarget,
} from "./clipboard-runtime-fixture.js";

it.effect(
  "person replacement retires an in-flight group before remaining members start and never exposes its owned payload or late result to the new person",
  () =>
    Effect.scoped(
      Effect.gen(function* retireGroup() {
        const entered = yield* Deferred.make<boolean>();
        const release = yield* Deferred.make<boolean>();
        let attempted = 0;
        const base = clipboardClient(0);

        const client = CalendarEditingClient.of({
          ...base.client,
          createEvent: (input) =>
            Effect.gen(function* heldCreate() {
              attempted += 1;
              yield* Deferred.succeed(entered, true);
              yield* Deferred.await(release);

              return CalendarEvent.make({
                ...input.event,
                accountId: input.accountId,
                calendarId: input.calendarId,
                eventId: input.id,
                status: "confirmed",
              });
            }),
        });

        yield* Effect.gen(function* replacingRuntime() {
          const runtime = yield* ClipboardRuntime;
          const old = yield* runtime.connect("person-A");
          const guests = yield* Deferred.make<string>();
          let receipts = 0;

          const observer = yield* old.notices.pipe(
            Stream.runForEach((notice) => {
              if (
                ClipboardNotice.guards.State(notice) &&
                ClipboardView.guards.Guests(notice.view)
              ) {
                return Deferred.succeed(guests, notice.view.intentId);
              }

              if (ClipboardNotice.guards.Receipt(notice)) {
                receipts += 1;
              }

              return Effect.void;
            }),
            Effect.forkScoped
          );

          const first = clipboardItem();

          const envelope = ClipboardEnvelope.make({
            id: "retiring-copy",
            items: [
              first,
              { ...first, source: { ...first.source, eventId: "next-member" } },
            ],
            personId: "person-A",
            selectionKeys: ["first", "next"],
            version: 1,
          });

          yield* old.native(
            NativeClipboardNotice.cases.Copied.make({
              envelope,
              mode: "copy",
              personId: "person-A",
              sequence: 1,
              sessionId: old.sessionId,
            })
          );
          yield* old.notices.pipe(
            Stream.filter(
              (notice) =>
                ClipboardNotice.guards.State(notice) &&
                Option.isSome(notice.view.copied)
            ),
            Stream.runHead
          );
          yield* old.native(
            NativeClipboardNotice.cases.Paste.make({
              anchor: clipboardPoint,
              copyId: envelope.id,
              personId: "person-A",
              sequence: 2,
              sessionId: old.sessionId,
              target: clipboardTarget,
            })
          );
          const intentId = yield* Deferred.await(guests);
          yield* runtime.dispatch(
            "person-A",
            old.sessionId,
            ClipboardAction.cases.Guests.make({ choice: "exclude", intentId })
          );
          yield* Deferred.await(entered);
          expect(attempted).toBe(1);
          const current = yield* runtime.connect("person-B");
          expect(old.canReceive()).toBe(false);
          expect(old.copied()).toBeUndefined();
          expect(current.copied()).toBeUndefined();
          yield* Deferred.succeed(release, true);

          const stale = yield* runtime
            .dispatch(
              "person-A",
              old.sessionId,
              ClipboardAction.cases.Retry.make({ intentId })
            )
            .pipe(Effect.result);

          expect(stale._tag).toBe("Failure");
          expect(attempted).toBe(1);
          expect(receipts).toBe(0);
          yield* Fiber.interrupt(observer);
        }).pipe(
          Effect.provide(ClipboardRuntime.layer),
          Effect.provideService(CalendarEditingClient, client),
          Effect.provideService(
            DeletionWriter,
            DeletionWriter.of({
              commit: () => Effect.die("Retired paste must not delete"),
            })
          )
        );
      })
    ).pipe(Effect.provide(NodeServices.layer))
);

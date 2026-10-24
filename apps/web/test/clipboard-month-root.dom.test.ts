import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Option, Stream } from "effect";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { ClipboardDelivery } from "../src/client/clipboard/delivery.js";
import { clipboardNativeHost } from "../src/client/clipboard/host.js";
import { ClipboardReceipt } from "../src/client/clipboard/machine.js";
import { ClipboardView } from "../src/client/clipboard/model.js";
import { observeNativeClipboard } from "../src/client/clipboard/native.js";
import {
  ClipboardAction,
  ClipboardNotice,
  ClipboardRuntime,
} from "../src/client/clipboard/runtime.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionWriter } from "../src/client/editing/delete-actor.js";
import { EditingRuntime } from "../src/client/editing/runtime.js";
import { MonthRuntime } from "../src/client/month/runtime.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { unusedSearchLayer } from "./browser-runtime-fixture.js";
import { monthArtifactAnchor } from "./clipboard-group-artifact-fixture.js";
import {
  groupClipboardFixture,
  groupNativeEvent,
} from "./clipboard-group-fixture.js";
import { clipboardClient } from "./clipboard-runtime-fixture.js";
import { unexpectedSearchClient } from "./search-fixture.js";

it.effect(
  "a single timed event uses the actual month-cell date anchor and normal root creation without inventing a clock or sending email",
  () =>
    Effect.scoped(
      Effect.gen(function* nativeSingleMonth() {
        const fixture = groupClipboardFixture(true);

        const source = visibleEvents(fixture.model).find(
          (event) => event.title === "Alpha"
        );

        const selected = yield* Effect.fromNullishOr(source).pipe(Effect.orDie);

        let model: AppModel = {
          ...fixture.model,
          calendar: { ...fixture.model.calendar, selected: [selected.key] },
        };

        const anchor = yield* monthArtifactAnchor(model);
        const memory = clipboardClient(0);
        yield* Effect.gen(function* singleMonthRuntime() {
          const runtime = yield* ClipboardRuntime;
          const connection = yield* runtime.connect(fixture.personId);
          const ready = yield* Deferred.make<boolean>();
          const copied = yield* Deferred.make<boolean>();
          const guests = yield* Deferred.make<string>();
          const done = yield* Deferred.make<boolean>();

          const observer = yield* connection.notices.pipe(
            Stream.runForEach((notice) =>
              Effect.gen(function* monthRecipient() {
                ({ model } = update(
                  model,
                  Message.ReceivedClipboard({
                    delivery: ClipboardDelivery.make({
                      epoch: model.clipboard.epoch,
                      notice,
                      personId: fixture.personId,
                      sessionId: connection.sessionId,
                    }),
                  })
                ));

                if (ClipboardNotice.guards.State(notice)) {
                  yield* Deferred.succeed(ready, true);

                  if (Option.isSome(notice.view.copied)) {
                    yield* Deferred.succeed(copied, true);
                  }

                  if (ClipboardView.guards.Guests(notice.view)) {
                    yield* Deferred.succeed(guests, notice.view.intentId);
                  }
                } else if (ClipboardReceipt.guards.Created(notice.receipt)) {
                  yield* Deferred.succeed(done, true);
                }
              })
            ),
            Effect.forkScoped
          );

          yield* Deferred.await(ready);
          const copy = groupNativeEvent();
          yield* connection.native(
            Option.getOrThrow(
              observeNativeClipboard(
                clipboardNativeHost(model, connection, anchor, document),
                copy.event,
                "copy",
                1,
                document,
                false
              )
            )
          );
          yield* Deferred.await(copied);
          const paste = groupNativeEvent(copy.data.get("text/plain"));
          yield* connection.native(
            Option.getOrThrow(
              observeNativeClipboard(
                clipboardNativeHost(model, connection, anchor, document),
                paste.event,
                "paste",
                2,
                document,
                false
              )
            )
          );
          const intentId = yield* Deferred.await(guests);
          expect(memory.calls).toHaveLength(0);

          const decision = update(
            model,
            Message.ClipboardAction({
              action: ClipboardAction.cases.Guests.make({
                choice: "exclude",
                intentId,
              }),
              personId: fixture.personId,
              sessionId: connection.sessionId,
            })
          );

          for (const command of decision.commands ?? []) {
            yield* command.effect;
          }

          yield* Deferred.await(done);
          expect(memory.calls).toHaveLength(1);
          expect(memory.calls[0]?.event.start).toEqual({
            dateTime: "2026-10-21T16:00:00.000Z",
            timeZone: "America/Los_Angeles",
          });
          expect(memory.calls[0]?.event.end).toEqual({
            dateTime: "2026-10-21T16:45:00.000Z",
            timeZone: "America/Los_Angeles",
          });
          expect(memory.calls[0]?.sendUpdates).toBe("none");
          expect(Option.isSome(model.editing.write)).toBe(true);
          expect(model.editing.view).toEqual(fixture.model.editing.view);
          yield* Fiber.interrupt(observer);
        }).pipe(
          Effect.provide(
            Layer.mergeAll(ClipboardRuntime.layer, MonthRuntime.layer)
          ),
          Effect.provideService(CalendarEditingClient, memory.client),
          Effect.provideService(
            EditingRuntime,
            EditingRuntime.of({
              connect: () => Effect.succeed(Stream.empty),
              dispatch: () =>
                Effect.die("Month paste must not replace the global editor"),
            })
          ),
          Effect.provideService(
            DeletionWriter,
            DeletionWriter.of({
              commit: () => Effect.die("Month paste must not delete"),
            })
          ),
          Effect.provide(unusedSearchLayer),
          Effect.provideService(CalendarSearchClient, unexpectedSearchClient)
        );
      })
    ).pipe(Effect.provide(NodeServices.layer))
);

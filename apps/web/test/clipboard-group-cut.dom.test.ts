import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Option, Schema, Stream } from "effect";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { BulkView } from "../src/client/bulk/model.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { ClipboardDelivery } from "../src/client/clipboard/delivery.js";
import { clipboardNativeHost } from "../src/client/clipboard/host.js";
import { ClipboardReceipt } from "../src/client/clipboard/machine.js";
import { observeNativeClipboard } from "../src/client/clipboard/native.js";
import {
  ClipboardNotice,
  ClipboardRuntime,
} from "../src/client/clipboard/runtime.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionWriter } from "../src/client/editing/delete-actor.js";
import { DeleteNotice } from "../src/client/editing/deletion-session.js";
import {
  EditingNotice,
  EditingRuntime,
} from "../src/client/editing/runtime.js";
import { MonthRuntime } from "../src/client/month/runtime.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import { unusedSearchLayer } from "./browser-runtime-fixture.js";
import {
  groupClipboardFixture,
  groupNativeEvent,
} from "./clipboard-group-fixture.js";
import { clipboardClient } from "./clipboard-runtime-fixture.js";
import { unexpectedSearchClient } from "./search-fixture.js";

it.effect.prop(
  "native group Cut arms the whole snapshot before exact-source bulk deletion; Undo writes nothing and Dismiss commits only staged originals",
  { missingSource: Schema.Boolean, undo: Schema.Boolean },
  ({ undo, missingSource }) =>
    Effect.scoped(
      Effect.gen(function* groupCutRecipient() {
        const fixture = groupClipboardFixture();
        const memory = clipboardClient(0);
        const committed: string[] = [];
        const reads: string[] = [];

        const client = CalendarEditingClient.of({
          ...memory.client,
          getEvent: (ref) =>
            Effect.gen(function* rereadExactOriginal() {
              reads.push(ref.eventId);

              const event = fixture.events.find(
                (source) =>
                  source.accountId === ref.accountId &&
                  source.calendarId === ref.calendarId &&
                  source.eventId === ref.eventId
              );

              return yield* Effect.fromNullishOr(event).pipe(Effect.orDie);
            }),
        });

        yield* Effect.gen(function* cutRuntimes() {
          const editing = yield* EditingRuntime;
          const clipboard = yield* ClipboardRuntime;
          const stream = yield* editing.connect(fixture.personId);
          const connection = yield* clipboard.connect(fixture.personId);
          let { model }: { model: AppModel } = fixture;
          const ready = yield* Deferred.make<boolean>();
          const staged = yield* Deferred.make<boolean>();
          const settled = yield* Deferred.make<boolean>();
          const expected = missingSource ? 2 : 3;
          let outcomes = 0;
          let rootReplays = 0;

          const editingObserver = yield* stream.pipe(
            Stream.runForEach((notice) =>
              Effect.gen(function* foldEditing() {
                ({ model } = update(
                  model,
                  Message.ReceivedEditing({
                    notice,
                    personId: fixture.personId,
                  })
                ));

                if (
                  EditingNotice.guards.Bulk(notice) &&
                  BulkView.guards.Settled(notice.view)
                ) {
                  yield* Deferred.succeed(staged, true);
                }

                if (
                  EditingNotice.guards.Delete(notice) &&
                  DeleteNotice.guards.Settled(notice.notice)
                ) {
                  outcomes += 1;

                  if (outcomes === expected) {
                    yield* Deferred.succeed(settled, true);
                  }
                }
              })
            ),
            Effect.forkScoped
          );

          const clipboardObserver = yield* connection.notices.pipe(
            Stream.runForEach((notice) =>
              Effect.gen(function* foldClipboard() {
                const message = Message.ReceivedClipboard({
                  delivery: ClipboardDelivery.make({
                    epoch: model.clipboard.epoch,
                    notice,
                    personId: fixture.personId,
                    sessionId: connection.sessionId,
                  }),
                });

                const result = update(model, message);
                ({ model } = result);

                if (ClipboardNotice.guards.State(notice)) {
                  yield* Deferred.succeed(ready, true);
                }

                if (
                  ClipboardNotice.guards.Receipt(notice) &&
                  ClipboardReceipt.guards.CutGroup(notice.receipt)
                ) {
                  expect(connection.copied()).toBeDefined();
                  expect(committed).toEqual([]);
                  rootReplays += update(model, message).commands?.length ?? 0;

                  for (const command of result.commands ?? []) {
                    yield* command.effect;
                  }
                }
              })
            ),
            Effect.forkScoped
          );

          yield* Deferred.await(ready);
          const copied = groupNativeEvent();

          const native = Option.getOrThrow(
            observeNativeClipboard(
              clipboardNativeHost(model, connection, fixture.anchor, document),
              copied.event,
              "cut",
              1,
              document,
              false
            )
          );

          if (missingSource) {
            model = {
              ...model,
              calendar: {
                ...model.calendar,
                reads: [
                  {
                    accountId: "work",
                    events: RemoteEvents.Success({
                      data: {
                        events: fixture.events.filter(
                          (source) => source.eventId !== "clipboard-group-1"
                        ),
                        versions: [],
                      },
                    }),
                  },
                ],
              },
            };
          }

          yield* connection.native(native);
          yield* Deferred.await(staged);
          expect(committed).toEqual([]);
          expect(
            model.editing.deletes.filter((mark) => mark.phase === "pending")
          ).toHaveLength(expected);
          expect(rootReplays).toBe(0);
          expect(reads.toSorted()).toEqual(
            fixture.events
              .filter(
                (source) =>
                  !missingSource || source.eventId !== "clipboard-group-1"
              )
              .map((source) => source.eventId)
              .toSorted()
          );

          const bulk = yield* Effect.succeed(model.editing.bulk).pipe(
            Effect.filterOrElse(BulkView.guards.Settled, () =>
              Effect.die("Group Cut has no settled bulk plan")
            )
          );

          expect(bulk.execution.plan.skipped).toHaveLength(
            missingSource ? 1 : 0
          );

          const action = update(
            model,
            Message.BulkControl({
              control: undo ? "undo" : "dismiss",
              personId: fixture.personId,
            })
          );

          ({ model } = action);

          for (const command of action.commands ?? []) {
            yield* command.effect;
          }

          yield* Deferred.await(settled);
          expect(committed.toSorted()).toEqual(undo ? [] : reads.toSorted());
          expect(memory.calls).toHaveLength(0);
          expect(connection.copied()).toBeDefined();
          yield* Fiber.interrupt(clipboardObserver);
          yield* Fiber.interrupt(editingObserver);
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              EditingRuntime.layer,
              ClipboardRuntime.layer,
              MonthRuntime.layer
            )
          ),
          Effect.provideService(CalendarEditingClient, client),
          Effect.provideService(
            DeletionWriter,
            DeletionWriter.of({
              commit: (input) =>
                Effect.sync(() => {
                  committed.push(input.request.eventId);
                  expect(input.request.sendUpdates).toBe("none");
                  expect(input.request.scope).toBe("single");
                }),
            })
          ),
          Effect.provide(unusedSearchLayer),
          Effect.provideService(CalendarSearchClient, unexpectedSearchClient)
        );
      })
    ).pipe(Effect.provide(NodeServices.layer))
);

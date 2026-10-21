import { Provider } from "@calendar/calendar/contracts";
import type { CreateEventInput } from "@calendar/calendar/contracts";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import {
  DateTime,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Option,
  Schema,
  Stream,
} from "effect";

import type { AppModel } from "../src/client/app.js";
import { Message, update } from "../src/client/app.js";
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
import {
  groupClipboardFixture,
  groupNativeEvent,
} from "./clipboard-group-fixture.js";
import { clipboardClient } from "./clipboard-runtime-fixture.js";
import { unexpectedSearchClient } from "./search-fixture.js";

const groupClient = (failAt: readonly boolean[]) => {
  const base = clipboardClient(0);
  const calls: (typeof CreateEventInput.Type)[] = [];

  const client = CalendarEditingClient.of({
    ...base.client,
    createEvent: (input) =>
      Effect.gen(function* groupCreateOutcome() {
        calls.push(input);

        if (failAt[calls.length - 1] === true) {
          return yield* new Provider({
            message: "Synthetic group member refusal",
            operation: "createEvent",
            status: 503,
          });
        }

        return yield* base.client.createEvent(input);
      }),
  });

  return { calls, client };
};

it.effect.prop(
  "native selected-group copy uses one guest decision and actual normal editor writes; partial results reconcile once without replaying successful members",
  {
    failAt: Schema.Tuple([Schema.Boolean, Schema.Boolean, Schema.Boolean]),
    include: Schema.Boolean,
    staleConsent: Schema.Boolean,
  },
  ({ failAt, include, staleConsent }) =>
    Effect.scoped(
      Effect.gen(function* groupRootPath() {
        const fixture = groupClipboardFixture();
        const failures = failAt.filter(Boolean).length;
        const memory = groupClient(failAt);
        yield* Effect.gen(function* ownedGroupRuntime() {
          const runtime = yield* ClipboardRuntime;
          const connection = yield* runtime.connect(fixture.personId);
          let { model }: { model: AppModel } = fixture;
          const ready = yield* Deferred.make<boolean>();
          const copied = yield* Deferred.make<boolean>();
          const guests = yield* Deferred.make<boolean>();

          const done =
            yield* Deferred.make<
              typeof ClipboardReceipt.cases.CreatedGroup.Type
            >();

          let reloads = 0;
          let replays = 0;

          const observer = yield* connection.notices.pipe(
            Stream.runForEach((notice) =>
              Effect.gen(function* groupRootNotice() {
                const message = Message.ReceivedClipboard({
                  delivery: ClipboardDelivery.make({
                    epoch: model.clipboard.epoch,
                    notice,
                    personId: connection.personId,
                    sessionId: connection.sessionId,
                  }),
                });

                const received = update(model, message);
                ({ model } = received);
                reloads +=
                  received.commands?.filter(
                    (command) => command.name === "ReadEvents"
                  ).length ?? 0;

                if (ClipboardNotice.guards.State(notice)) {
                  yield* Deferred.succeed(ready, true);

                  if (Option.isSome(notice.view.copied)) {
                    yield* Deferred.succeed(copied, true);
                  }

                  if (ClipboardView.guards.Guests(notice.view)) {
                    yield* Deferred.succeed(guests, true);
                  }
                } else if (
                  ClipboardReceipt.guards.CreatedGroup(notice.receipt)
                ) {
                  replays += update(model, message).commands?.length ?? 0;
                  yield* Deferred.succeed(done, notice.receipt);
                }
              })
            ),
            Effect.forkScoped
          );

          yield* Deferred.await(ready);
          const copy = groupNativeEvent();

          const host = clipboardNativeHost(
            model,
            connection,
            fixture.anchor,
            document
          );

          expect(host?.selected).toBeUndefined();
          expect(host?.group?.selection).toEqual(fixture.keys);

          const notice = Option.getOrThrow(
            observeNativeClipboard(host, copy.event, "copy", 1, document, false)
          );

          expect(copy.event.defaultPrevented).toBe(true);
          expect([...copy.data.keys()]).toEqual(["text/plain"]);
          expect(copy.data.get("text/plain")).not.toContain("Alpha");
          yield* connection.native(notice);
          yield* Deferred.await(copied);
          const paste = groupNativeEvent(copy.data.get("text/plain"));
          yield* connection.native(
            Option.getOrThrow(
              observeNativeClipboard(
                clipboardNativeHost(
                  model,
                  connection,
                  fixture.anchor,
                  document
                ),
                paste.event,
                "paste",
                2,
                document,
                false
              )
            )
          );
          yield* Deferred.await(guests);

          const view = yield* Effect.succeed(model.clipboard.view).pipe(
            Effect.filterOrElse(ClipboardView.guards.Guests, () =>
              Effect.die("Group guest projection missing")
            )
          );

          expect(view.itemCount).toBe(3);
          expect(view.count).toBe(2);
          expect(memory.calls).toHaveLength(0);

          if (staleConsent) {
            yield* runtime.dispatch(
              connection.personId,
              connection.sessionId,
              ClipboardAction.cases.Guests.make({
                choice: "includeAndEmail",
                intentId: "stale-intent",
              })
            );
          }

          const decision = update(
            model,
            Message.ClipboardAction({
              action: ClipboardAction.cases.Guests.make({
                choice: include ? "includeAndEmail" : "exclude",
                intentId: view.intentId,
              }),
              personId: connection.personId,
              sessionId: connection.sessionId,
            })
          );

          for (const command of decision.commands ?? []) {
            yield* command.effect;
          }

          const result = yield* Deferred.await(done);
          expect(memory.calls).toHaveLength(3);
          expect(new Set(memory.calls.map((call) => call.id)).size).toBe(3);
          expect(result.mutations).toHaveLength(3 - failures);
          expect(
            result.mutations.map((mutation) => mutation.event.title)
          ).toEqual(
            ["Gamma", "Beta", "Alpha"].filter(
              (_title, index) => failAt[index] !== true
            )
          );
          expect(Option.isSome(model.editing.write)).toBe(failures < 3);
          expect(replays).toBe(0);
          expect(reloads > 0).toBe(failures < 3);
          expect(model.calendar.rangeRequest).toBe(
            fixture.model.calendar.rangeRequest + (failures === 3 ? 0 : 1)
          );
          expect(ClipboardView.guards.Results(model.clipboard.view)).toBe(true);

          if (ClipboardView.guards.Results(model.clipboard.view)) {
            expect(model.clipboard.view.succeeded).toBe(3 - failures);
            expect(model.clipboard.view.issues).toHaveLength(failures);
            expect(
              model.clipboard.view.issues.map((issue) => issue.title)
            ).toEqual(
              ["Gamma", "Beta", "Alpha"].filter(
                (_title, index) => failAt[index] === true
              )
            );
          }

          expect(memory.calls.map((call) => call.event.title)).toEqual([
            "Gamma",
            "Beta",
            "Alpha",
          ]);
          expect(
            memory.calls.map((call) =>
              call.event.start !== undefined && "dateTime" in call.event.start
                ? new Intl.DateTimeFormat("en-GB", {
                    hour: "2-digit",
                    hourCycle: "h23",
                    minute: "2-digit",
                    timeZone: "America/Los_Angeles",
                  }).format(
                    DateTime.toEpochMillis(
                      DateTime.makeUnsafe(call.event.start.dateTime)
                    )
                  )
                : undefined
            )
          ).toEqual(["14:00", "12:00", "10:00"]);
          expect(
            memory.calls.map((call) =>
              call.event.end !== undefined && "dateTime" in call.event.end
                ? new Intl.DateTimeFormat("en-GB", {
                    hour: "2-digit",
                    hourCycle: "h23",
                    minute: "2-digit",
                    timeZone: "America/Los_Angeles",
                  }).format(
                    DateTime.toEpochMillis(
                      DateTime.makeUnsafe(call.event.end.dateTime)
                    )
                  )
                : undefined
            )
          ).toEqual(["14:45", "12:45", "10:45"]);

          for (const call of memory.calls) {
            expect(call.sendUpdates).toBe(
              include && call.event.title !== "Gamma" ? "all" : "none"
            );
            expect(call.event.recurrence).toEqual([]);
            expect(call.event.guestsCanModify).toBe(false);
            expect(call.event.reminders).toEqual({
              overrides: [{ method: "popup", minutes: 10 }],
              useDefault: false,
            });
            expect(call.event.attendees).toEqual(
              include && call.event.title !== "Gamma"
                ? [
                    {
                      email: `${call.event.title?.toLowerCase()}@example.test`,
                      optional: call.event.title === "Beta",
                      resource: false,
                      responseStatus: "needsAction",
                    },
                  ]
                : []
            );
          }

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
                Effect.die("Group paste must not replace the global editor"),
            })
          ),
          Effect.provideService(
            DeletionWriter,
            DeletionWriter.of({
              commit: () => Effect.die("Group paste must not delete"),
            })
          ),
          Effect.provideService(CalendarSearchClient, unexpectedSearchClient)
        );
      })
    ).pipe(Effect.provide(NodeServices.layer))
);

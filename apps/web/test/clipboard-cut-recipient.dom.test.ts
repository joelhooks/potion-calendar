import { CalendarEvent } from "@calendar/calendar/contracts";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Option, Stream } from "effect";

import { Message, update } from "../src/client/app.js";
import { ClipboardDelivery } from "../src/client/clipboard/delivery.js";
import { ClipboardReceipt } from "../src/client/clipboard/machine.js";
import { initialClipboardView } from "../src/client/clipboard/model.js";
import {
  ClipboardNotice,
  ClipboardRuntime,
} from "../src/client/clipboard/runtime.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionWriter } from "../src/client/editing/delete-actor.js";
import { DeleteNotice } from "../src/client/editing/deletion-session.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import {
  EditingCommand,
  EditingNotice,
  EditingRuntime,
} from "../src/client/editing/runtime.js";
import { MonthRuntime } from "../src/client/month/runtime.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import { unusedSearchLayer } from "./browser-runtime-fixture.js";
import { clipboardClient } from "./clipboard-runtime-fixture.js";
import { fixtureSelection, fixtureEvents } from "./fixture.js";
import { unexpectedSearchClient } from "./search-fixture.js";

it.effect.each(["undo", "dismiss"] as const)(
  "root Cut uses the real pending deletion session and normal %s outcome, with no clipboard-owned delete",
  (decision) =>
    Effect.scoped(
      Effect.gen(function* clipboardNormalDeleteRecipient() {
        const base = fixtureSelection();
        const [candidate] = fixtureEvents;

        const original = yield* Effect.fromOption(
          Option.fromUndefinedOr(candidate)
        ).pipe(Effect.orDie);

        const source = CalendarEvent.make({
          ...original,
          attendees: [],
          conferenceUrl: undefined,
        });

        const reads: string[] = [];
        const committed: string[] = [];
        const memory = clipboardClient(0);

        const client = CalendarEditingClient.of({
          ...memory.client,
          getEvent: (ref) =>
            Effect.sync(() => {
              reads.push(ref.eventId);

              return source;
            }),
        });

        yield* Effect.gen(function* realDeletionSession() {
          const editing = yield* EditingRuntime;
          const clipboard = yield* ClipboardRuntime;
          const connection = yield* clipboard.connect("fixture-person");
          const pending = yield* Deferred.make<string>();
          const committedNotice = yield* Deferred.make<boolean>();
          const stream = yield* editing.connect("fixture-person");

          const observer = yield* stream.pipe(
            Stream.runForEach((notice) => {
              if (EditingNotice.guards.Delete(notice)) {
                if (
                  DeleteNotice.guards.Changed(notice.notice) &&
                  notice.notice.phase === "pending"
                ) {
                  return Deferred.succeed(pending, notice.notice.intent.id);
                }

                if (DeleteNotice.guards.Settled(notice.notice)) {
                  return Deferred.succeed(committedNotice, true);
                }
              }

              return Effect.void;
            }),
            Effect.forkScoped
          );

          const state = update(
            base,
            Message.ReceivedClipboard({
              delivery: ClipboardDelivery.make({
                epoch: 0,
                notice: ClipboardNotice.cases.State.make({
                  view: initialClipboardView,
                }),
                personId: "fixture-person",
                sessionId: connection.sessionId,
              }),
            })
          ).model;

          const cut = Message.ReceivedClipboard({
            delivery: ClipboardDelivery.make({
              epoch: 0,
              notice: ClipboardNotice.cases.Receipt.make({
                receipt: ClipboardReceipt.cases.Cut.make({
                  copyId: "owned-copy",
                  id: "owned-cut",
                  revision: 1,
                  source,
                }),
              }),
              personId: "fixture-person",
              sessionId: connection.sessionId,
            }),
          });

          const result = update(state, cut);

          for (const command of result.commands ?? []) {
            yield* command.effect;
          }

          const intent = yield* Deferred.await(pending);
          expect(reads).toEqual([source.eventId]);
          expect(committed).toEqual([]);
          const replay = update(result.model, cut);
          expect(replay.commands).toBeUndefined();
          yield* editing.dispatch(
            "fixture-person",
            EditingCommand.cases.Action.make({
              action:
                decision === "undo"
                  ? EditorAction.cases.Undo.make({ id: intent })
                  : EditorAction.cases.DismissUndo.make({ id: intent }),
            })
          );
          yield* Deferred.await(committedNotice);
          expect(committed).toEqual(
            decision === "undo" ? [] : [source.eventId]
          );
          expect(memory.calls).toHaveLength(0);
          yield* Fiber.interrupt(observer);
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
                }),
            })
          ),
          Effect.provide(unusedSearchLayer),
          Effect.provideService(CalendarSearchClient, unexpectedSearchClient)
        );
      })
    ).pipe(Effect.provide(NodeServices.layer))
);

import { CalendarEvent } from "@calendar/calendar/contracts";
import { watchActor } from "@calendar/capability/actor-watch";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { createEffectActor, snapshots } from "@xstate/effect";
import { Crypto, Effect, Layer, Ref, Schema, Stream } from "effect";
import { FetchHttpClient } from "effect/http";

import { response } from "../../../packages/calendar/test/fake-google.js";
import { clipboardGroupMachine } from "../src/client/clipboard/group-machine.js";
import { ClipboardAnchor } from "../src/client/clipboard/model.js";
import {
  ClipboardPreparation,
  prepareClipboardPaste,
} from "../src/client/clipboard/prepare.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionWriter } from "../src/client/editing/delete-actor.js";
import { DeletionSession } from "../src/client/editing/deletion-session.js";
import {
  captureSelectionClipboard,
  SelectionClipboardCapture,
} from "../src/layout/selection-clipboard.js";
import { monthArtifactAnchor } from "./clipboard-group-artifact-fixture.js";
import { groupClipboardFixture } from "./clipboard-group-fixture.js";
import { clipboardTarget } from "./clipboard-runtime-fixture.js";
import { editingRpcFixture, writeBody } from "./editing-rpc-fixture.js";

it.effect.each([
  { allDay: false, include: false, month: false },
  { allDay: false, include: true, month: false },
  { allDay: true, include: false, month: false },
  { allDay: true, include: true, month: false },
  { allDay: false, include: false, month: true },
  { allDay: false, include: true, month: true },
])(
  "group creation reaches actual RPC and fake Google with one choice, independent creation IDs and no imported recurrence or native conference: %s",
  ({ allDay, include, month }) =>
    Effect.gen(function* groupRpc() {
      const source = groupClipboardFixture(month);
      const hourBase = month ? 16 : 17;
      let anchor: typeof ClipboardAnchor.Type = source.anchor;

      if (allDay) {
        anchor = ClipboardAnchor.cases.AllDay.make({ date: "2026-10-21" });
      }

      if (month) {
        anchor = yield* monthArtifactAnchor(source.model);
      }

      const events = source.events.map((event, index) =>
        CalendarEvent.make({
          ...event,
          conferenceUrl: "https://meet.google.com/source-only",
          end: allDay ? { date: `2026-10-${22 + index}` } : event.end,
          recurrence: ["RRULE:FREQ=WEEKLY"],
          reminders: { useDefault: true },
          start: allDay ? { date: `2026-10-${19 + index}` } : event.start,
        })
      );

      const capturedValue = captureSelectionClipboard({
        candidates: events.map((event) => ({ event, key: event.eventId })),
        copyId: "group-rpc-copy",
        personId: source.personId,
        selection: events.map((event) => event.eventId),
        selfEmails: ["owner@example.test"],
      });

      const captured = yield* Effect.succeed(capturedValue).pipe(
        Effect.filterOrElse(SelectionClipboardCapture.guards.Captured, () =>
          Effect.die("RPC group capture failed")
        )
      );

      const preparedValue = yield* prepareClipboardPaste({
        choice: include ? "includeAndEmail" : "exclude",
        pending: {
          anchor,
          copyId: captured.snapshot.copyId,
          group: captured.snapshot,
          intentId: "group-rpc-paste",
          item: captured.snapshot.members[0].item,
          target: clipboardTarget,
        },
      });

      const prepared = yield* Effect.succeed(preparedValue).pipe(
        Effect.filterOrElse(ClipboardPreparation.guards.PreparedGroup, () =>
          Effect.die("RPC group preparation failed")
        )
      );

      const fixture = yield* editingRpcFixture(
        events.map((event, index) =>
          response(200, {
            end: allDay
              ? { date: `2026-10-${24 + index}` }
              : { dateTime: `2026-10-21T${hourBase + index * 2}:45:00Z` },
            id: `new-group-${index}`,
            start: allDay
              ? { date: `2026-10-${21 + index}` }
              : { dateTime: `2026-10-21T${hourBase + index * 2}:00:00Z` },
            status: "confirmed",
            summary: event.title ?? "Event",
          })
        )
      );

      yield* Effect.gen(function* normalGroupRpc() {
        const client = yield* CalendarEditingClient;
        const crypto = yield* Crypto.Crypto;

        const deletion = yield* DeletionSession.make().pipe(
          Effect.provideService(
            DeletionWriter,
            DeletionWriter.of({
              commit: () => Effect.die("Group create must not delete"),
            })
          )
        );

        const actor = yield* createEffectActor(clipboardGroupMachine, {
          input: prepared,
        }).pipe(
          Effect.provideService(CalendarEditingClient, client),
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.provideService(DeletionSession, deletion)
        );

        yield* watchActor("calendar.clipboard.group.rpc.test", actor);

        const result = yield* snapshots(actor).pipe(
          Stream.filter(
            (snapshot) =>
              snapshot.status === "done" || snapshot.status === "error"
          ),
          Stream.runHead,
          Effect.flatMap(Effect.fromOption)
        );

        expect(result.status).toBe("done");
        expect(result.output?.mutations).toHaveLength(3);
        expect(result.output?.issues).toEqual([]);
      }).pipe(
        Effect.provide(
          CalendarEditingClient.layer("available").pipe(
            Layer.provide(FetchHttpClient.layer)
          )
        ),
        Effect.provideService(FetchHttpClient.Fetch, fixture.fetcher)
      );
      const requests = yield* Ref.get(fixture.fake.requests);
      expect(requests).toHaveLength(3);
      expect(requests.every((request) => request.method === "POST")).toBe(true);
      const ids: string[] = [];

      for (const [index, request] of requests.entries()) {
        const body = writeBody(request.body ?? "{}");
        ids.push(
          yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)(body.id)
        );
        expect(request.path).toContain(
          `sendUpdates=${include && index < 2 ? "all" : "none"}`
        );
        expect(body.recurrence).toEqual([]);
        expect(body.guestsCanModify).toBe(false);
        expect(body.reminders).toEqual({ useDefault: true });
        expect(body).not.toHaveProperty("conferenceData");
        expect(body).not.toHaveProperty("recurringEventId");
        expect(body.attendees).toEqual(
          include && index < 2
            ? [
                {
                  email: `${index === 0 ? "alpha" : "beta"}@example.test`,
                  optional: index === 1,
                  resource: false,
                  responseStatus: "needsAction",
                },
              ]
            : []
        );
        expect(body.start).toEqual(
          allDay
            ? { date: `2026-10-${21 + index}` }
            : {
                dateTime: `2026-10-21T${hourBase + index * 2}:00:00.000Z`,
                timeZone: "America/Los_Angeles",
              }
        );
        expect(body.end).toEqual(
          allDay
            ? { date: `2026-10-${24 + index}` }
            : {
                dateTime: `2026-10-21T${hourBase + index * 2}:45:00.000Z`,
                timeZone: "America/Los_Angeles",
              }
        );
      }

      expect(new Set(ids).size).toBe(3);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

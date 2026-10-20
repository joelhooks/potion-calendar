import { CalendarEvent } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Ref, Stream } from "effect";
import { FetchHttpClient } from "effect/http";

import { response } from "../../../packages/calendar/test/fake-google.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionSession } from "../src/client/editing/deletion-session.js";
import { LoadedEditor } from "../src/client/editing/editor-session-model.js";
import { prepareEditor } from "../src/client/editing/prepare-editor.js";
import { writeEditor } from "../src/client/editing/write-editor.js";
import { eventDraft } from "../src/layout/editor-draft.js";
import { editingRpcFixture, writeBody } from "./editing-rpc-fixture.js";
import { editorCalendars } from "./editor-fixture.js";
import { fixtureSelection } from "./fixture.js";

const zone = "America/Los_Angeles";

const master = {
  end: { dateTime: "2026-03-01T10:00:00-08:00", timeZone: zone },
  iCalUID: "series@fixture.test",
  id: "series",
  organizer: { self: true },
  recurrence: ["RRULE:FREQ=WEEKLY"],
  start: { dateTime: "2026-03-01T09:00:00-08:00", timeZone: zone },
  status: "confirmed",
  summary: "Series",
};

const selected = {
  ...master,
  end: { dateTime: "2026-03-15T10:00:00-07:00", timeZone: zone },
  id: "instance",
  originalStartTime: { dateTime: "2026-03-15T09:00:00-07:00", timeZone: zone },
  recurringEventId: "series",
  start: { dateTime: "2026-03-15T09:00:00-07:00", timeZone: zone },
};

const moved = { ...master, id: "actual-destination-master" };

it.effect.each(["saved", "partial", "uncertain"])(
  "the editor's combined series path preserves the %s real-RPC outcome without a second move",
  (outcome) =>
    Effect.gen(function* combinedSeriesWrite() {
      const event = CalendarEvent.make({
        accountId: "work",
        calendarId: "primary",
        end: selected.end,
        eventId: selected.id,
        organizer: { self: true },
        originalStartTime: selected.originalStartTime,
        recurringEventId: "series",
        start: selected.start,
        status: "confirmed",
        title: "Series",
      });

      const series = CalendarEvent.make({
        ...event,
        end: master.end,
        eventId: master.id,
        recurrence: master.recurrence,
        start: master.start,
      });

      const baseline = yield* eventDraft(event, series, zone);

      const session = LoadedEditor.make({
        baseline,
        calendars: editorCalendars,
        createId: Option.none(),
        draft: {
          ...baseline,
          calendarId: "team",
          endTime: "12:00",
          startTime: "11:00",
        },
        id: "fixture-series-move",
        kind: "edit",
        master: Option.some(series),
        moveSupport: "available",
        navigation: fixtureSelection().calendar.navigation,
        operation: "save",
        original: Option.some(event),
        selection: Option.none(),
      });

      const plan = yield* prepareEditor(session);

      const responses = [
        response(200, selected),
        response(200, master),
        ...(outcome === "uncertain"
          ? [response(503)]
          : [
              response(200, moved),
              outcome === "partial"
                ? response(403)
                : response(200, {
                    ...moved,
                    end: {
                      dateTime: "2026-03-01T20:00:00.000Z",
                      timeZone: zone,
                    },
                    start: {
                      dateTime: "2026-03-01T19:00:00.000Z",
                      timeZone: zone,
                    },
                  }),
            ]),
      ];

      const api = yield* editingRpcFixture(responses);

      const result = yield* writeEditor(plan).pipe(
        Effect.provideService(
          DeletionSession,
          DeletionSession.of({
            dispatch: () => Effect.die("Unexpected delete"),
            subscribe: Effect.succeed(Stream.empty),
          })
        ),
        Effect.provide(CalendarEditingClient.layer("available")),
        Effect.provideService(FetchHttpClient.Fetch, api.fetcher),
        Effect.match({
          onFailure: (failure) => ({ failure }),
          onSuccess: (mutation) => ({ mutation }),
        })
      );

      const requests = yield* Ref.get(api.fake.requests);

      const moves = requests.filter((request) =>
        request.path.includes("/move?")
      );

      expect(moves).toHaveLength(1);
      expect(requests).toHaveLength(outcome === "uncertain" ? 3 : 4);

      if (outcome === "saved") {
        expect("mutation" in result).toBe(true);
        const patch = requests.find((request) => request.method === "PATCH");
        expect(patch?.path).toContain("actual-destination-master");
        expect(writeBody(patch?.body)).toMatchObject({
          end: { dateTime: "2026-03-01T20:00:00.000Z" },
          start: { dateTime: "2026-03-01T19:00:00.000Z" },
        });
      } else {
        expect("failure" in result).toBe(true);

        if ("failure" in result) {
          expect(result.failure._tag).toBe(
            outcome === "partial"
              ? "SeriesMoveRetimePartial"
              : "SeriesMoveRetimeUncertain"
          );
        }

        if (outcome === "uncertain") {
          expect(requests.some((request) => request.method === "PATCH")).toBe(
            false
          );
        }
      }
    })
);

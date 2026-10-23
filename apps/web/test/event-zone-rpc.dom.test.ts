import { CalendarEvent } from "@calendar/calendar/contracts";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Ref, Stream } from "effect";
import { FetchHttpClient } from "effect/http";

import { response } from "../../../packages/calendar/test/fake-google.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionSession } from "../src/client/editing/deletion-session.js";
import {
  EditorRequest,
  LoadedEditor,
} from "../src/client/editing/editor-session-model.js";
import { loadEditor } from "../src/client/editing/load-editor.js";
import { prepareEditor } from "../src/client/editing/prepare-editor.js";
import { writeEditor } from "../src/client/editing/write-editor.js";
import { eventDraft } from "../src/layout/editor-draft.js";
import { editingRpcFixture, writeBody } from "./editing-rpc-fixture.js";
import { editorCalendars } from "./editor-fixture.js";
import { fixtureSelection } from "./fixture.js";

const master = {
  end: {
    dateTime: "2026-03-01T10:00:00-08:00",
    timeZone: "America/Los_Angeles",
  },
  id: "series",
  organizer: { self: true },
  recurrence: ["RRULE:FREQ=WEEKLY"],
  start: {
    dateTime: "2026-03-01T09:00:00-08:00",
    timeZone: "America/Los_Angeles",
  },
  status: "confirmed",
  summary: "Weekly review",
};

const selected = {
  ...master,
  end: {
    dateTime: "2026-03-15T10:00:00-07:00",
    timeZone: "America/Los_Angeles",
  },
  id: "instance",
  originalStartTime: { dateTime: "2026-03-15T09:00:00-07:00" },
  recurringEventId: "series",
  start: {
    dateTime: "2026-03-15T09:00:00-07:00",
    timeZone: "America/Los_Angeles",
  },
};

const zoneSession = Effect.fn("zoneEditorSession")(function* zoneSession() {
  const event = CalendarEvent.make({
    accountId: "work",
    attendees: [{ email: "guest@example.test", responseStatus: "needsAction" }],
    calendarId: "primary",
    end: selected.end,
    eventId: selected.id,
    organizer: selected.organizer,
    originalStartTime: selected.originalStartTime,
    recurringEventId: selected.recurringEventId,
    start: selected.start,
    status: "confirmed",
    title: selected.summary,
  });

  const series = CalendarEvent.make({
    ...event,
    end: master.end,
    eventId: master.id,
    recurrence: master.recurrence,
    start: master.start,
  });

  const baseline = yield* eventDraft(event, series, "Asia/Tokyo");

  return LoadedEditor.make({
    baseline,
    calendars: editorCalendars,
    createId: Option.none(),
    draft: { ...baseline, timeZone: "Asia/Tokyo" },
    id: "event-zone-test",
    kind: "edit",
    master: Option.some(series),
    moveSupport: "available",
    navigation: fixtureSelection().calendar.navigation,
    operation: "save",
    original: Option.some(event),
    selection: Option.none(),
  });
});

it.effect.each(["new", "existing"])(
  "%s editor loads preserve a travel-grid drag's instant in the home/event zone",
  (kind) =>
    Effect.gen(function* travelRangeLoad() {
      const sourceSession = yield* zoneSession();
      const source = yield* Effect.fromOption(sourceSession.original);

      const range = {
        allDay: false,
        endDate: "2026-10-19",
        endTime: "11:00",
        startDate: "2026-10-19",
        startTime: "10:00",
      };

      const common = {
        calendars: editorCalendars,
        navigation: sourceSession.navigation,
        primaryZone: "America/Los_Angeles",
        rangeZone: "Asia/Tokyo",
        selection: Option.none<string>(),
      };

      const request =
        kind === "new"
          ? EditorRequest.cases.New.make({
              ...common,
              ...range,
              ref: { accountId: "work", calendarId: "primary" },
            })
          : EditorRequest.cases.Existing.make({
              ...common,
              event: source,
              mode: "edit",
              range,
            });

      const api = yield* editingRpcFixture(
        kind === "new" ? [] : [response(200, selected), response(200, master)]
      );

      const loaded = yield* loadEditor(request).pipe(
        Effect.provide(CalendarEditingClient.layer("available")),
        Effect.provideService(FetchHttpClient.Fetch, api.fetcher),
        Effect.provide(NodeServices.layer)
      );

      expect(loaded.draft).toMatchObject({
        endDate: "2026-10-18",
        endTime: "19:00",
        startDate: "2026-10-18",
        startTime: "18:00",
        timeZone: "America/Los_Angeles",
      });
      const fields = yield* prepareEditor(loaded);
      expect(fields.fields.start).toEqual({
        dateTime: "2026-10-19T01:00:00.000Z",
        timeZone: "America/Los_Angeles",
      });
      expect(fields.fields.end).toEqual({
        dateTime: "2026-10-19T02:00:00.000Z",
        timeZone: "America/Los_Angeles",
      });
    })
);

it.effect("new weekly events carry their chosen zone through create RPC", () =>
  Effect.gen(function* createZonedEvent() {
    const loaded = yield* zoneSession();

    const session = {
      ...loaded,
      createId: Option.some("0".repeat(32)),
      kind: "create",
      master: Option.none(),
      original: Option.none(),
    } satisfies typeof loaded;

    const plan = yield* prepareEditor(session);
    const api = yield* editingRpcFixture([response(200, selected)]);
    yield* writeEditor(plan).pipe(
      Effect.provideService(
        DeletionSession,
        DeletionSession.of({
          dispatch: () => Effect.die("Unexpected delete"),
          subscribe: Effect.succeed(Stream.empty),
        })
      ),
      Effect.provide(CalendarEditingClient.layer("available")),
      Effect.provideService(FetchHttpClient.Fetch, api.fetcher)
    );
    const requests = yield* Ref.get(api.fake.requests);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.path).toContain("sendUpdates=none");
    expect(writeBody(requests[0]?.body)).toMatchObject({
      end: { dateTime: "2026-03-15T01:00:00.000Z", timeZone: "Asia/Tokyo" },
      recurrence: ["RRULE:FREQ=WEEKLY"],
      start: { dateTime: "2026-03-15T00:00:00.000Z", timeZone: "Asia/Tokyo" },
    });
  })
);

it.effect.each(["single", "allFollowing", "all"] as const)(
  "zone editing writes both named endpoints and preserves the wall clock through real RPC for %s",
  (scope) =>
    Effect.gen(function* zoneWrite() {
      const session = yield* zoneSession();
      const plan = yield* prepareEditor(session);
      expect(plan.choices).toContain(scope);
      expect(plan.emailNeeded).toBe(true);
      expect(plan.sendUpdates).toBe("none");
      expect(plan.dayChanged).toBe(false);
      expect(plan.noEmailOnly).toBe(false);
      expect(plan.changes).toEqual({
        end: { dateTime: "2026-03-15T01:00:00.000Z", timeZone: "Asia/Tokyo" },
        start: { dateTime: "2026-03-15T00:00:00.000Z", timeZone: "Asia/Tokyo" },
      });

      const api = yield* editingRpcFixture([
        response(200, selected),
        ...(scope === "single" ? [] : [response(200, master)]),
        ...(scope === "allFollowing" ? [response(200, master)] : []),
        response(200, scope === "all" ? master : selected),
        ...(scope === "allFollowing" ? [response(200, master)] : []),
      ]);

      yield* writeEditor({ ...plan, scope }).pipe(
        Effect.provideService(
          DeletionSession,
          DeletionSession.of({
            dispatch: () => Effect.die("Unexpected delete"),
            subscribe: Effect.succeed(Stream.empty),
          })
        ),
        Effect.provide(CalendarEditingClient.layer("available")),
        Effect.provideService(FetchHttpClient.Fetch, api.fetcher)
      );

      const requests = yield* Ref.get(api.fake.requests);

      const write = requests.find((request) =>
        scope === "allFollowing"
          ? request.method === "POST"
          : request.method === "PATCH"
      );

      expect(write?.path).toContain("sendUpdates=none");
      expect(writeBody(write?.body)).toMatchObject({
        end: {
          dateTime:
            scope === "all"
              ? "2026-03-01T01:00:00.000Z"
              : "2026-03-15T01:00:00.000Z",
          timeZone: "Asia/Tokyo",
        },
        start: {
          dateTime:
            scope === "all"
              ? "2026-03-01T00:00:00.000Z"
              : "2026-03-15T00:00:00.000Z",
          timeZone: "Asia/Tokyo",
        },
      });

      if (scope === "all") {
        expect(write?.path).toContain("/events/series?");
      }

      if (scope === "allFollowing") {
        expect(writeBody(write?.body)).toHaveProperty("recurrence", [
          "RRULE:FREQ=WEEKLY",
        ]);

        const truncation = requests.find(
          (request) => request.method === "PATCH"
        );

        expect(writeBody(truncation?.body)).toHaveProperty("recurrence", [
          "RRULE:FREQ=WEEKLY;UNTIL=20260315T155959Z",
        ]);
      }
    })
);

import { CalendarEvent } from "@calendar/calendar/contracts";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Ref, Struct } from "effect";
import { FetchHttpClient } from "effect/http";

import { response } from "../../../packages/calendar/test/fake-google.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionSession } from "../src/client/editing/deletion-session.js";
import { EditorRequest } from "../src/client/editing/editor-session-model.js";
import { loadEditor } from "../src/client/editing/load-editor.js";
import { prepareEditor } from "../src/client/editing/prepare-editor.js";
import { writeEditor } from "../src/client/editing/write-editor.js";
import {
  bindBulkWrite,
  BulkPermission,
  planBulk,
} from "../src/layout/bulk-plans.js";
import { dayFromIso, initialNavigation } from "../src/layout/navigation.js";
import { editingRpcFixture, writeBody } from "./editing-rpc-fixture.js";
import { editorCalendars } from "./editor-fixture.js";

const restricted = {
  guestsCanInviteOthers: false,
  guestsCanModify: false,
  guestsCanSeeOtherGuests: false,
  transparency: "transparent",
  visibility: "private",
} as const;

const fields = [
  "visibility",
  "transparency",
  "guestsCanModify",
  "guestsCanInviteOthers",
  "guestsCanSeeOtherGuests",
] as const;

type PrivacySourceFields = Pick<
  typeof CalendarEvent.Type,
  (typeof fields)[number]
>;

const cases = [
  restricted,
  {
    guestsCanInviteOthers: true,
    guestsCanModify: true,
    guestsCanSeeOtherGuests: true,
    transparency: "opaque",
    visibility: "public",
  },
  {},
  Struct.omit(restricted, ["visibility"]),
  Struct.omit(restricted, ["transparency"]),
  Struct.omit(restricted, ["guestsCanModify"]),
  Struct.omit(restricted, ["guestsCanInviteOthers"]),
  Struct.omit(restricted, ["guestsCanSeeOtherGuests"]),
] satisfies readonly PrivacySourceFields[];

it.effect.each(
  (["editor", "alt-drag", "bulk"] as const).flatMap((path) =>
    cases.map((privacy) => ({ path, privacy }))
  )
)(
  "duplicate %j sends source privacy exactly to fake Google and leaves missing fields absent",
  ({ path, privacy }) =>
    Effect.gen(function* duplicatePrivacy() {
      const provider = {
        ...privacy,
        attendees: [],
        end: { dateTime: "2026-10-19T10:00:00-07:00" },
        id: "duplicate-source",
        organizer: { email: "owner@example.test", self: true },
        reminders: { useDefault: true },
        start: { dateTime: "2026-10-19T09:00:00-07:00" },
        status: "confirmed",
        summary: "Private source",
      };

      const source = CalendarEvent.make({
        accountId: "work",
        attendees: [],
        calendarId: "primary",
        end: provider.end,
        eventId: provider.id,
        guestsCanInviteOthers: true,
        guestsCanModify: true,
        guestsCanSeeOtherGuests: true,
        organizer: provider.organizer,
        reminders: provider.reminders,
        start: provider.start,
        status: "confirmed",
        title: provider.summary,
        transparency: "opaque",
        visibility: "public",
      });

      const fixture = yield* editingRpcFixture([
        response(200, provider),
        response(200, { ...provider, id: "created-copy" }),
      ]);

      const opening = {
        calendars: editorCalendars,
        navigation: initialNavigation(dayFromIso("2026-10-19")),
        primaryZone: "America/Los_Angeles",
        selection: Option.some("copy-source"),
      };

      const bulk = planBulk(
        "duplicate",
        ["copy-source"],
        [
          {
            event: source,
            key: "copy-source",
            permission: BulkPermission.cases.Allowed.make({}),
          },
        ],
        opening
      );

      const step = yield* Effect.fromNullishOr(bulk.steps[0]);

      const request = EditorRequest.cases.Existing.make({
        ...opening,
        event: source,
        mode: "duplicate",
      });

      const rangedRequest =
        path === "alt-drag"
          ? EditorRequest.cases.Existing.make({
              ...request,
              range: {
                allDay: false,
                endDate: "2026-10-20",
                endTime: "12:00",
                startDate: "2026-10-20",
                startTime: "11:00",
              },
            })
          : request;

      yield* Effect.gen(function* createCopy() {
        const loaded = yield* loadEditor(
          path === "bulk" ? step.request : rangedRequest
        );

        const prepared = yield* prepareEditor(loaded);

        const plan =
          path === "bulk" ? yield* bindBulkWrite(step, prepared) : prepared;

        yield* writeEditor(plan);
      }).pipe(
        Effect.provide(
          CalendarEditingClient.layer("available").pipe(
            Layer.provide(FetchHttpClient.layer)
          )
        ),
        Effect.provideService(FetchHttpClient.Fetch, fixture.fetcher),
        Effect.provideService(
          DeletionSession,
          DeletionSession.of({
            dispatch: () => Effect.die("Duplicate must not delete"),
            subscribe: Effect.die("Duplicate must not subscribe to deletion"),
          })
        )
      );

      const requests = yield* Ref.get(fixture.fake.requests);
      const posts = requests.filter((call) => call.method === "POST");
      expect(posts).toHaveLength(1);
      expect(requests.filter((call) => call.method === "GET")).toHaveLength(1);
      const post = yield* Effect.fromNullishOr(posts[0]);
      const body = writeBody(post.body ?? "{}");

      const expectedPrivacy: PrivacySourceFields = privacy;

      for (const field of fields) {
        if (Object.hasOwn(privacy, field)) {
          expect(body[field]).toBe(expectedPrivacy[field]);
        } else {
          expect(Object.hasOwn(body, field)).toBe(false);
        }
      }

      expect(body.start).toEqual(
        path === "bulk"
          ? provider.start
          : {
              dateTime:
                path === "alt-drag"
                  ? "2026-10-20T18:00:00.000Z"
                  : "2026-10-19T16:00:00.000Z",
              timeZone: "America/Los_Angeles",
            }
      );
      expect(
        requests.some(
          (call) => call.method === "PATCH" || call.method === "DELETE"
        )
      ).toBe(false);
    }).pipe(Effect.provide(NodeServices.layer))
);

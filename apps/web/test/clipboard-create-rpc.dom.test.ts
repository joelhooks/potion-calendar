import { CalendarEvent } from "@calendar/calendar/contracts";
import { watchActor } from "@calendar/capability/actor-watch";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { createEffectActor, snapshots } from "@xstate/effect";
import { Crypto, DateTime, Effect, Layer, Option, Ref, Stream } from "effect";
import { FetchHttpClient } from "effect/http";

import { response } from "../../../packages/calendar/test/fake-google.js";
import { clipboardCreatorMachine } from "../src/client/clipboard/creator-machine.js";
import { ClipboardAnchor } from "../src/client/clipboard/model.js";
import { placeClipboardItem } from "../src/client/clipboard/placement.js";
import { prepareClipboardTemplate } from "../src/client/clipboard/template.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionWriter } from "../src/client/editing/delete-actor.js";
import { DeletionSession } from "../src/client/editing/deletion-session.js";
import { EditorRequest } from "../src/client/editing/editor-session-model.js";
import { loadEditor } from "../src/client/editing/load-editor.js";
import { prepareEditor } from "../src/client/editing/prepare-editor.js";
import { writeEditor } from "../src/client/editing/write-editor.js";
import { dayFromIso, initialNavigation } from "../src/layout/navigation.js";
import { clipboardItem, clipboardSource } from "./clipboard-fixture.js";
import { editingRpcFixture, writeBody } from "./editing-rpc-fixture.js";
import { editorCalendars } from "./editor-fixture.js";

const creationRange = (allDay: boolean) =>
  allDay
    ? { end: { date: "2026-10-22" }, start: { date: "2026-10-19" } }
    : {
        end: {
          dateTime: "2026-10-19T18:30:00.000Z",
          timeZone: "America/Los_Angeles",
        },
        start: {
          dateTime: "2026-10-19T17:00:00.000Z",
          timeZone: "America/Los_Angeles",
        },
      };

const expectedReminders = (
  ordinary: boolean,
  allDay: boolean,
  sourceUseDefault: boolean
) => {
  if (sourceUseDefault) {
    return { useDefault: true };
  }

  if (!ordinary) {
    return { overrides: [{ method: "popup", minutes: 10 }], useDefault: false };
  }

  return allDay ? { overrides: [], useDefault: false } : { useDefault: true };
};

it.effect.each([
  ...(["ordinary", "withoutGuests", "includeGuests"] as const).flatMap(
    (kind) => [
      { allDay: false, kind, sourceUseDefault: false },
      { allDay: true, kind, sourceUseDefault: false },
    ]
  ),
  { allDay: true, kind: "withoutGuests", sourceUseDefault: true },
])(
  "%s creation reaches actual RPC and fake Google with the intended reminders, permissions, home endpoints and email choice",
  ({ allDay, kind, sourceUseDefault }) =>
    Effect.gen(function* clipboardRpc() {
      const created = response(200, {
        ...creationRange(allDay),
        id: "pasted-event",
        status: "confirmed",
        summary: "Product review",
      });

      const noCalendarRead =
        sourceUseDefault || (kind === "ordinary" && !allDay);

      const replies = noCalendarRead
        ? [created]
        : [
            response(200, {
              accessRole: "owner",
              defaultReminders: [{ method: "popup", minutes: 30 }],
              id: "primary",
            }),
            created,
          ];

      const fixture = yield* editingRpcFixture(replies);

      const item = clipboardItem(
        allDay
          ? CalendarEvent.make({
              ...clipboardSource,
              end: { date: "2026-10-22" },
              reminders: sourceUseDefault
                ? { useDefault: true }
                : clipboardSource.reminders,
              start: { date: "2026-10-19" },
            })
          : clipboardSource
      );

      const placed = yield* placeClipboardItem(
        item,
        allDay
          ? ClipboardAnchor.cases.AllDay.make({ date: "2026-10-19" })
          : ClipboardAnchor.cases.Timed.make({
              date: "2026-10-19",
              instant: DateTime.toEpochMillis(
                DateTime.makeUnsafe("2026-10-19T17:00:00.000Z")
              ),
            }),
        "America/Los_Angeles"
      );

      const normal = EditorRequest.cases.New.make({
        ...placed,
        calendars: editorCalendars,
        navigation: initialNavigation(dayFromIso("2026-10-19")),
        primaryZone: "America/Los_Angeles",
        ref: { accountId: "work", calendarId: "primary" },
        selection: Option.none(),
      });

      const template = yield* prepareClipboardTemplate(
        item,
        "paste-rpc-intent",
        kind === "includeGuests" ? "includeAndEmail" : "exclude"
      );

      const request =
        kind === "ordinary"
          ? normal
          : EditorRequest.cases.New.make({ ...normal, template });

      yield* Effect.gen(function* createThroughNormalPath() {
        const client = yield* CalendarEditingClient;
        const crypto = yield* Crypto.Crypto;

        const deletion = yield* DeletionSession.make().pipe(
          Effect.provideService(
            DeletionWriter,
            DeletionWriter.of({
              commit: () => Effect.die("Create must not delete"),
            })
          )
        );

        if (kind === "ordinary") {
          const session = yield* loadEditor(request);
          const plan = yield* prepareEditor(session);
          yield* writeEditor(plan).pipe(
            Effect.provideService(DeletionSession, deletion)
          );
        } else {
          const actor = yield* createEffectActor(clipboardCreatorMachine, {
            input: { request },
          }).pipe(
            Effect.provideService(CalendarEditingClient, client),
            Effect.provideService(Crypto.Crypto, crypto),
            Effect.provideService(DeletionSession, deletion)
          );

          yield* watchActor("calendar.clipboard.rpc.test", actor);

          const final = yield* snapshots(actor).pipe(
            Stream.filter(
              (snapshot) =>
                snapshot.status === "error" ||
                snapshot.status === "done" ||
                snapshot.matches({ active: "failed" }) ||
                snapshot.matches({ active: "refused" })
            ),
            Stream.runHead,
            Effect.flatMap(Effect.fromOption)
          );

          expect(final.status, JSON.stringify(final.context.failure)).toBe(
            "done"
          );
        }
      }).pipe(
        Effect.provide(
          CalendarEditingClient.layer("available").pipe(
            Layer.provide(FetchHttpClient.layer)
          )
        ),
        Effect.provideService(FetchHttpClient.Fetch, fixture.fetcher)
      );

      const requests = yield* Ref.get(fixture.fake.requests);
      expect(requests).toHaveLength(noCalendarRead ? 1 : 2);
      expect(
        requests
          .filter((call) => call.method === "GET")
          .every((call) => !call.path.includes("/events"))
      ).toBe(true);
      const post = requests.find((call) => call.method === "POST");
      expect(post?.method).toBe("POST");
      expect(post?.path).toContain(
        `sendUpdates=${kind === "includeGuests" ? "all" : "none"}`
      );
      const body = writeBody(post?.body ?? "{}");
      expect(body).toMatchObject({
        ...creationRange(allDay),
        guestsCanInviteOthers: kind === "ordinary",
        guestsCanModify: kind === "ordinary",
        guestsCanSeeOtherGuests: kind === "ordinary",
      });

      expect(body.reminders).toEqual(
        expectedReminders(kind === "ordinary", allDay, sourceUseDefault)
      );

      if (allDay) {
        expect(body.start).toEqual({ date: "2026-10-19" });
        expect(body.end).toEqual({ date: "2026-10-22" });
      }

      if (kind !== "ordinary") {
        expect(body).toMatchObject({
          transparency: "transparent",
          visibility: "private",
        });
      }

      expect(body.attendees).toEqual(
        kind === "includeGuests"
          ? [
              {
                displayName: "Alex",
                email: "alex@example.test",
                optional: true,
                resource: false,
                responseStatus: "needsAction",
              },
            ]
          : []
      );

      expect(body.recurrence).toEqual([]);

      for (const key of [
        "recurringEventId",
        "originalStartTime",
        "conferenceData",
        "conferenceDataVersion",
        "conferenceUrl",
        "hangoutLink",
        "conferencing",
        "conferencingStatus",
      ]) {
        expect(body).not.toHaveProperty(key);
      }

      expect(JSON.stringify(body)).not.toContain("native-private");
      expect(JSON.stringify(body)).not.toContain("provider-only-ical");
    }).pipe(Effect.provide(NodeServices.layer))
);

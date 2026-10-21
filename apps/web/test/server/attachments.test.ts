import {
  CalendarEvent,
  ListCalendarsOutput,
} from "@calendar/calendar/contracts";
import { NodeServices } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Context, DateTime, Effect, Layer, Option, Predicate } from "effect";
import { FetchHttpClient } from "effect/http";
import { vi } from "vitest";

import { captureClipboardItem } from "../../src/client/clipboard/capture.js";
import {
  ClipboardAnchor,
  ClipboardCaptureResult,
} from "../../src/client/clipboard/model.js";
import { prepareClipboardPaste } from "../../src/client/clipboard/prepare.js";
import { CalendarEditingClient } from "../../src/client/editing/calendar-client.js";
import { DeletionWriter } from "../../src/client/editing/delete-actor.js";
import { DeletionSession } from "../../src/client/editing/deletion-session.js";
import { EditorRequest } from "../../src/client/editing/editor-session-model.js";
import { loadEditor } from "../../src/client/editing/load-editor.js";
import { prepareEditor } from "../../src/client/editing/prepare-editor.js";
import { writeEditor } from "../../src/client/editing/write-editor.js";
import { DevelopmentRuntime } from "../../src/dev/native-runtime.js";
import { dayFromIso, initialNavigation } from "../../src/layout/navigation.js";
import { settingsRpcFixture } from "./settings-rpc-fixture.js";

class AttachmentRoots extends Context.Service<
  AttachmentRoots,
  Effect.Success<typeof settingsRpcFixture>
>()("test/AttachmentRoots") {}

const fixtureLayer = Layer.effect(AttachmentRoots, settingsRpcFixture).pipe(
  Layer.provide(DevelopmentRuntime.layer("http://127.0.0.1:5173"))
);

layer(fixtureLayer, { excludeTestServices: true })(
  "native attachment preservation",
  (it) => {
    it.effect(
      "title edit, time move, calendar move, duplicate and pasted creation retain known structured attachments through authenticated Worker and D1",
      () =>
        Effect.gen(function* nativeAttachments() {
          const fixture = yield* AttachmentRoots;
          const { accountId, calendarId } = fixture.target;
          vi.stubGlobal("location", new URL(fixture.origin));
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => vi.unstubAllGlobals())
          );

          // @effect-diagnostics-next-line asyncFunction:off -- Native Fetch forwards generated client commands to the authenticated local Worker.
          const fetcher: typeof fetch = async (input, init) => {
            const request = new Request(
              input instanceof Request
                ? input
                : new URL(input.toString(), fixture.origin),
              init
            );

            const headers = new Headers(request.headers);
            headers.set("cookie", fixture.runtime.person.cookie);
            headers.set("origin", fixture.origin);
            headers.set("sec-fetch-site", "same-origin");

            return await fixture.runtime.handle(
              new Request(request, { headers })
            );
          };

          const attachments = [
            {
              iconUrl:
                "https://drive-thirdparty.googleusercontent.com/pdf-icon",
              mimeType: "application/pdf",
              title: "Review notes",
              url: "https://drive.google.com/file/d/known-document/view",
            },
          ];

          const source = yield* fixture.success(
            "createEvent",
            {
              accountId,
              calendarId,
              event: {
                attachments,
                end: { dateTime: "2026-10-20T11:00:00Z" },
                start: { dateTime: "2026-10-20T10:00:00Z" },
                title: "Original with file",
              },
              id: "a77ac0",
            },
            CalendarEvent
          );

          expect(source.attachments).toEqual(attachments);

          const renamed = yield* fixture.success(
            "updateEvent",
            {
              accountId,
              calendarId,
              changes: { title: "Renamed without file mutation" },
              eventId: source.eventId,
              scope: "single",
            },
            CalendarEvent
          );

          expect(renamed.attachments).toEqual(attachments);

          const shifted = yield* fixture.success(
            "updateEvent",
            {
              accountId,
              calendarId,
              changes: {
                end: { dateTime: "2026-10-20T13:00:00Z" },
                start: { dateTime: "2026-10-20T12:00:00Z" },
              },
              eventId: source.eventId,
              scope: "single",
            },
            CalendarEvent
          );

          expect(shifted.attachments).toEqual(attachments);

          const listing = yield* fixture.success(
            "listCalendars",
            {},
            ListCalendarsOutput
          );

          const destination = listing.accounts
            .flatMap((account) =>
              "calendars" in account ? account.calendars : []
            )
            .find(
              (calendar) =>
                calendar.accountId === accountId &&
                calendar.calendarId !== calendarId
            );

          if (destination === undefined) {
            return yield* Effect.die("Missing destination calendar");
          }

          const moved = yield* fixture.success(
            "moveEvent",
            {
              accountId,
              calendarId,
              destination: { accountId, calendarId: destination.calendarId },
              eventId: source.eventId,
            },
            CalendarEvent
          );

          expect(moved.attachments).toEqual(attachments);

          const read = yield* fixture.success(
            "getEvent",
            {
              accountId,
              calendarId: destination.calendarId,
              eventId: moved.eventId,
            },
            CalendarEvent
          );

          expect(read.attachments).toEqual(attachments);

          yield* Effect.gen(function* copiedEditorRoots() {
            const navigation = initialNavigation(dayFromIso("2026-10-21"));
            const captured = captureClipboardItem(read, ["owner@example.test"]);
            expect(ClipboardCaptureResult.guards.Captured(captured)).toBe(true);

            if (!ClipboardCaptureResult.guards.Captured(captured)) {
              return yield* Effect.die("Attachment capture refused");
            }

            const prepared = yield* prepareClipboardPaste({
              choice: "exclude",
              pending: {
                anchor: ClipboardAnchor.cases.Timed.make({
                  date: "2026-10-21",
                  instant: DateTime.toEpochMillis(
                    DateTime.makeUnsafe("2026-10-21T10:00:00Z")
                  ),
                }),
                copyId: "copy-files",
                intentId: "paste-files",
                item: captured.item,
                target: {
                  calendar: destination,
                  navigation,
                  primaryZone: "UTC",
                  selection: Option.none(),
                },
              },
            });

            expect(prepared._tag).toBe("Prepared");

            if (!Predicate.isTagged(prepared, "Prepared")) {
              return yield* Effect.die("Attachment paste refused");
            }

            const deletion = yield* DeletionSession.make().pipe(
              Effect.provideService(
                DeletionWriter,
                DeletionWriter.of({
                  commit: () => Effect.die("Unexpected deletion"),
                })
              )
            );

            const requests = [
              prepared.request,
              EditorRequest.cases.Existing.make({
                calendars: [destination],
                event: read,
                mode: "duplicate",
                navigation,
                primaryZone: "UTC",
                selection: Option.none(),
              }),
            ];

            for (const request of requests) {
              const loaded = yield* loadEditor(request);
              expect(loaded.draft.attachments).toEqual(attachments);

              const saved = yield* writeEditor(
                yield* prepareEditor(loaded)
              ).pipe(Effect.provideService(DeletionSession, deletion));

              expect(saved._tag).toBe("Saved");

              if (Predicate.isTagged(saved, "Saved")) {
                expect(saved.event.attachments).toEqual(attachments);
                expect(saved.event.eventId).not.toBe(source.eventId);

                const persisted = yield* fixture.success(
                  "getEvent",
                  {
                    accountId,
                    calendarId: destination.calendarId,
                    eventId: saved.event.eventId,
                  },
                  CalendarEvent
                );

                expect(persisted.attachments).toEqual(attachments);
              }
            }

            return requests.length;
          }).pipe(
            Effect.provide(CalendarEditingClient.layer("available")),
            Effect.provideService(FetchHttpClient.Fetch, fetcher)
          );

          return source.eventId;
        }).pipe(Effect.provide(NodeServices.layer))
    );
  }
);

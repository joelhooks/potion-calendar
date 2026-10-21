import type { EventFieldsValue } from "@calendar/calendar/contracts";
import { Effect, Option, Ref } from "effect";
import { FetchHttpClient } from "effect/http";

import {
  ref,
  response,
  timedEvent,
} from "../../../packages/calendar/test/fake-google.js";
import { eventKey, RemoteEvents } from "../src/client/calendar-state.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import {
  createTypeRuntimeFixture,
  nextTypeNotice,
} from "./create-type-runtime-fixture.js";

export type SavedStatusType = "focusTime" | "outOfOffice";

export type SavedStatusMode = NonNullable<
  EventFieldsValue["focusTimeProperties"]
>["autoDeclineMode"];

export const statusFidelityScenes = [
  "ooo-details",
  "focus-details",
  "ooo-editor",
  "focus-editor",
  "focus-create",
] as const;

export type StatusFidelityScene = (typeof statusFidelityScenes)[number];

export const savedStatusFixture = Effect.fn("savedStatusFixture")(
  function* savedStatusFixture(input: {
    readonly type: SavedStatusType;
    readonly mode: SavedStatusMode;
    readonly role?: "owner" | "writer" | "reader";
    readonly primary?: boolean;
    readonly organizer?: boolean;
  }) {
    const f = yield* createTypeRuntimeFixture("event");
    yield* f.dispatch(EditorAction.cases.Cancel.make({}));
    yield* nextTypeNotice(f.queue, (notice) =>
      EditorView.guards.Closed(notice.view)
    );

    const calendar = {
      ...f.calendar,
      accessRole: input.role ?? "owner",
      primary: input.primary ?? true,
    };

    const properties =
      input.mode === undefined
        ? { declineMessage: "Existing response text" }
        : {
            autoDeclineMode: input.mode,
            declineMessage: "Existing response text",
          };

    const statusFields =
      input.type === "focusTime"
        ? { focusTimeProperties: { ...properties, chatStatus: "doNotDisturb" } }
        : { outOfOfficeProperties: properties };

    const rawFields = {
      ...statusFields,
      attachments: [
        {
          fileUrl: "https://files.example.test/private-notes",
          title: "Private notes",
        },
      ],
      attendees: [
        { email: "owner@example.test", responseStatus: "accepted", self: true },
        {
          displayName: "Casey",
          email: "casey@example.test",
          responseStatus: "needsAction",
        },
      ],
      description: "Private notes https://example.test/source-notes",
      end: {
        dateTime:
          input.type === "outOfOffice"
            ? "2026-10-24T00:00:00.000Z"
            : "2026-10-21T17:00:00.000Z",
        timeZone: "America/Los_Angeles",
      },
      eventType: input.type,
      hangoutLink: "https://meet.google.com/abc-defg-hij",
      location: "Station hall https://meet.google.com/abc-defg-hij",
      organizer: { email: "owner@example.test", self: input.organizer ?? true },
      start: {
        dateTime: "2026-10-21T16:00:00.000Z",
        timeZone: "America/Los_Angeles",
      },
      transparency: "opaque",
    };

    const eventId = input.type === "focusTime" ? "saved-focus" : "saved-ooo";

    const raw = timedEvent(
      eventId,
      input.type === "focusTime" ? "Writing time" : "Out of office",
      rawFields
    );

    yield* Ref.set(f.api.fake.pending, [response(200, raw)]);

    const source = yield* CalendarEditingClient.use((client) =>
      client.getEvent({ ...ref, eventId })
    ).pipe(
      Effect.provide(CalendarEditingClient.layer("notAvailable")),
      Effect.provideService(FetchHttpClient.Fetch, f.api.fetcher)
    );

    const closed = yield* Ref.get(f.state);
    yield* Ref.set(f.state, {
      ...closed,
      calendar: {
        ...closed.calendar,
        calendars: [calendar],
        mergeDuplicates: false,
        reads: [
          {
            accountId: ref.accountId,
            events: RemoteEvents.Success({
              data: { events: [source], versions: [] },
            }),
          },
        ],
        selected: [eventKey(source)],
      },
    });

    const open = Effect.fn("openSavedStatusEditor")(
      function* openSavedStatusEditor() {
        yield* Ref.set(f.api.fake.pending, [response(200, raw)]);
        yield* f.dispatch(EditorAction.cases.OpenEdit.make({}));

        return yield* nextTypeNotice(f.queue, (notice) =>
          EditorView.guards.Editing(notice.view)
        );
      }
    );

    const titleEdit = Effect.fn("saveStatusTitle")(function* saveStatusTitle() {
      yield* f.editText("title", "Drafting the plan");
      const beforeSave = yield* Ref.get(f.state);
      yield* Ref.set(f.api.fake.pending, [
        response(200, raw),
        response(200, { ...raw, summary: "Drafting the plan" }),
      ]);
      yield* f.dispatch(EditorAction.cases.Save.make({}));

      const settled = yield* nextTypeNotice(f.queue, (notice) =>
        Option.isSome(notice.mutation)
      );

      return { beforeSave, settled };
    });

    return { ...f, calendar, open, raw, source, titleEdit };
  }
);

export {
  nextTypeNotice,
  renderTypeRoot as renderStatusRoot,
} from "./create-type-runtime-fixture.js";

import { GoogleCalendarClient } from "@calendar/calendar";
import { Calendar } from "@calendar/calendar/contracts";
import type { EventFieldsValue } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Ref, Result, Schema } from "effect";
import { FetchHttpClient } from "effect/http";

import {
  ref,
  response,
  timedEvent,
} from "../../../packages/calendar/test/fake-google.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { changeEditor } from "../src/client/editing/change-editor.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { LoadedEditor } from "../src/client/editing/editor-session-model.js";
import {
  prepareEditor,
  permissionsForEditor,
} from "../src/client/editing/prepare-editor.js";
import { createDraft, eventDraft } from "../src/layout/editor-draft.js";
import { initialNavigation, dayFromIso } from "../src/layout/navigation.js";
import { editingRpcFixture, writeBody } from "./editing-rpc-fixture.js";
import { renderEditorFixture } from "./editor-fixture.js";

const newSession = Effect.fn("newTypeSession")(function* newSession() {
  const draft = yield* createDraft({
    allDay: false,
    endDate: "2026-10-21",
    endTime: "10:00",
    ref,
    startDate: "2026-10-21",
    startTime: "09:00",
    timeZone: "America/Los_Angeles",
  });

  const calendar = Calendar.make({
    ...ref,
    accessRole: "owner",
    primary: true,
    timeZone: draft.timeZone,
    title: "Work",
  });

  return LoadedEditor.make({
    baseline: draft,
    calendars: [
      calendar,
      { ...calendar, calendarId: "secondary", primary: false },
    ],
    createId: Option.some("0123456789abcdef"),
    draft,
    id: "type-session",
    kind: "create",
    master: Option.none(),
    moveSupport: "notAvailable",
    navigation: initialNavigation(dayFromIso("2026-10-19")),
    operation: "save",
    original: Option.none(),
    selection: Option.none(),
  });
});

const checkStatusPlan = Effect.fn("checkStatusPlan")(function* checkStatusPlan(
  session: typeof LoadedEditor.Type,
  model: {
    readonly type: string;
    readonly primary: boolean;
    readonly allDay: boolean;
    readonly declineNew: boolean;
  }
) {
  const result = yield* prepareEditor(session).pipe(Effect.result);

  const permitted =
    model.type === "default" || (model.primary && !model.allDay);

  expect(Result.isSuccess(result)).toBe(permitted);

  if (Result.isSuccess(result) && model.type !== "default") {
    expect(result.success.fields.eventType).toBe(model.type);
    expect(result.success.fields.transparency).toBe("opaque");
    expect(result.success.fields.attendees).toEqual([]);
    expect(result.success.sendUpdates).toBe("none");
    expect(result.success.emailNeeded).toBe(false);

    const properties =
      model.type === "focusTime"
        ? result.success.fields.focusTimeProperties
        : result.success.fields.outOfOfficeProperties;

    expect(properties?.autoDeclineMode).toBe(
      model.declineNew ? "declineOnlyNewConflictingInvitations" : "declineNone"
    );
  }
});

it.effect.prop(
  "generated type, calendar, all-day and invitation histories keep status writes eligible and preserve only the explicit automatic-decline choice",
  {
    commands: Schema.Array(
      Schema.Literals([
        "event",
        "focus",
        "ooo",
        "decline",
        "keep",
        "allDay",
        "primary",
        "secondary",
        "save",
      ])
    ).check(Schema.isMinLength(1), Schema.isMaxLength(24)),
  },
  ({ commands }) =>
    Effect.gen(function* typeHistories() {
      let session = yield* newSession();

      const model = {
        allDay: false,
        declineNew: false,
        primary: true,
        type: "default",
      };

      for (const command of [...commands, "save"]) {
        if (command === "save") {
          yield* checkStatusPlan(session, model);

          continue;
        }

        let action: typeof EditorAction.Type;
        let allowed = true;

        if (command === "event" || command === "focus" || command === "ooo") {
          const type = {
            event: "default",
            focus: "focusTime",
            ooo: "outOfOffice",
          }[command];

          allowed = type === "default" || (model.primary && !model.allDay);
          action = EditorAction.cases.EventTypeSelected.make({ value: type });

          if (allowed) {
            model.type = type;
            model.declineNew = false;
          }
        } else if (command === "allDay") {
          action = EditorAction.cases.ToggleAllDay.make({});
          model.allDay = !model.allDay;
        } else if (command === "decline" || command === "keep") {
          const declineNew = command === "decline";
          allowed = model.type !== "default";
          action = EditorAction.cases.StatusInvitationsChosen.make({
            value: declineNew,
          });

          if (allowed) {
            model.declineNew = declineNew;
          }
        } else {
          model.primary = command === "primary";
          action = EditorAction.cases.CalendarSelected.make({
            value: JSON.stringify([
              ref.accountId,
              model.primary ? ref.calendarId : "secondary",
            ]),
          });
        }

        const result = yield* changeEditor({
          action,
          custom: Option.none(),
          session,
        }).pipe(Effect.result);

        expect(Result.isSuccess(result)).toBe(allowed);

        if (Result.isSuccess(result)) {
          session = result.success;
        }

        expect(session.draft.eventType ?? "default").toBe(model.type);
        expect(session.draft.allDay).toBe(model.allDay);
        expect(session.draft.calendarId).toBe(
          model.primary ? ref.calendarId : "secondary"
        );
        expect(
          session.draft.statusInvitationChoice ===
            "declineOnlyNewConflictingInvitations"
        ).toBe(model.declineNew);
      }
    })
);

it.effect.prop(
  "the real create RPC rechecks Google's calendar and refuses non-primary, non-owner or all-day status inserts",
  {
    allDay: Schema.Boolean,
    primary: Schema.Boolean,
    role: Schema.Literals(["owner", "writer", "reader", "freeBusyReader"]),
    type: Schema.Literals(["focusTime", "outOfOffice"]),
  },
  ({ primary, role, allDay, type }) =>
    Effect.gen(function* serverTypeBoundary() {
      const permitted = primary && role === "owner" && !allDay;

      const event = {
        attendees: [],
        end: allDay
          ? { date: "2026-10-22" }
          : { dateTime: "2026-10-21T17:00:00Z" },
        eventType: type,
        start: allDay
          ? { date: "2026-10-21" }
          : { dateTime: "2026-10-21T16:00:00Z" },
        transparency: "opaque",
        ...(type === "focusTime"
          ? { focusTimeProperties: { autoDeclineMode: "declineNone" } }
          : { outOfOfficeProperties: { autoDeclineMode: "declineNone" } }),
      } satisfies EventFieldsValue;

      const api = yield* editingRpcFixture([
        response(200, { accessRole: role, id: ref.calendarId, primary }),
        ...(permitted
          ? [
              response(
                200,
                timedEvent("0123456789abcdef", "Status", { eventType: type })
              ),
            ]
          : []),
      ]);

      const result = yield* CalendarEditingClient.use((client) =>
        client.createEvent({
          ...ref,
          event,
          id: "0123456789abcdef",
          sendUpdates: "none",
        })
      ).pipe(
        Effect.provide(CalendarEditingClient.layer("notAvailable")),
        Effect.provideService(FetchHttpClient.Fetch, api.fetcher),
        Effect.result
      );

      expect(Result.isSuccess(result)).toBe(permitted);

      const posts = (yield* Ref.get(api.fake.receipts)).filter(
        (receipt) => receipt.request.method === "POST"
      );

      expect(posts).toHaveLength(permitted ? 1 : 0);
    })
);

it.effect(
  "saved Focus properties remain readable but changing a saved type is rejected and no creation-only field reaches PATCH",
  () =>
    Effect.gen(function* immutableType() {
      const initial = yield* newSession();

      const session = LoadedEditor.make({
        ...initial,
        draft: { ...initial.draft, eventType: "focusTime" },
        kind: "edit",
      });

      const changed = yield* changeEditor({
        action: EditorAction.cases.EventTypeSelected.make({ value: "default" }),
        custom: Option.none(),
        session,
      }).pipe(Effect.result);

      expect(Result.isFailure(changed)).toBe(true);

      const focus = timedEvent("saved-focus", "Writing", {
        eventType: "focusTime",
        focusTimeProperties: {
          autoDeclineMode: "declineAllConflictingInvitations",
          chatStatus: "doNotDisturb",
          declineMessage: "Writing",
        },
      });

      const api = yield* editingRpcFixture([
        response(200, focus),
        response(200, { ...focus, summary: "Updated" }),
      ]);

      const refused = yield* CalendarEditingClient.use((client) =>
        client.updateEvent({
          ...ref,
          changes: { eventType: "default" },
          eventId: "saved-focus",
          scope: "single",
          sendUpdates: "none",
        })
      ).pipe(
        Effect.provide(CalendarEditingClient.layer("notAvailable")),
        Effect.provideService(FetchHttpClient.Fetch, api.fetcher),
        Effect.result
      );

      expect(Result.isFailure(refused)).toBe(true);
      expect(yield* Ref.get(api.fake.receipts)).toHaveLength(0);

      const saved = yield* CalendarEditingClient.use((client) =>
        client.updateEvent({
          ...ref,
          changes: { title: "Updated" },
          eventId: "saved-focus",
          scope: "single",
          sendUpdates: "none",
        })
      ).pipe(
        Effect.provide(CalendarEditingClient.layer("notAvailable")),
        Effect.provideService(FetchHttpClient.Fetch, api.fetcher)
      );

      expect(saved.eventType).toBe("focusTime");
      expect(saved.focusTimeProperties?.chatStatus).toBe("doNotDisturb");

      const savedSession = {
        ...session,
        draft: yield* eventDraft(saved, undefined, "America/Los_Angeles"),
        original: Option.some(saved),
      };

      const rendered = yield* renderEditorFixture(
        EditorView.cases.Editing.make({
          draft: savedSession.draft,
          error: Option.none(),
          kind: "edit",
          moveSupport: "notAvailable",
          operation: "save",
          original: savedSession.original,
          permissions: permissionsForEditor(savedSession),
        }),
        savedSession.calendars
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      expect(document.body.textContent).toContain("Event type: Focus time");
      expect(document.querySelector("#event-type")).toBeNull();

      yield* Ref.set(api.fake.pending, [
        response(200, { ...focus, summary: "Wire boundary" }),
      ]);
      yield* GoogleCalendarClient.use((google) =>
        google.patch(
          { ...ref, eventId: "saved-focus" },
          {
            eventType: "default",
            focusTimeProperties: { autoDeclineMode: "declineNone" },
            outOfOfficeProperties: { autoDeclineMode: "declineNone" },
            title: "Wire boundary",
          },
          { sendUpdates: "none" }
        )
      ).pipe(
        Effect.provide(
          GoogleCalendarClient.layer.pipe(Layer.provide(api.fake.layer))
        )
      );

      const patches = (yield* Ref.get(api.fake.receipts)).filter(
        (receipt) => receipt.request.method === "PATCH"
      );

      expect(patches).toHaveLength(2);
      expect(writeBody(patches[0]?.request.body)).toEqual({
        summary: "Updated",
      });
      expect(writeBody(patches[1]?.request.body)).toEqual({
        summary: "Wire boundary",
      });
    })
);

import { Effect, Option, Predicate, Ref } from "effect";
import { AsyncData } from "foldkit";

import { Message } from "../src/client/app.js";
import { RemoteEvents, eventKey } from "../src/client/calendar-state.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import type { WritePlan } from "../src/client/editing/editor-session-model.js";
import { EditorMutation } from "../src/client/editing/editor-session-model.js";
import { EditingNotice } from "../src/client/editing/runtime.js";
import { keyboardMessage } from "../src/client/keyboard/input.js";
import { keyboardRegistry } from "../src/client/keyboard/registry.js";
import {
  instantRuntimeFixture,
  nextInstantNotice,
} from "./instant-runtime-fixture.js";

export const instantScenarios = [
  "meeting-delete",
  "repeat-delete",
  "readonly-delete",
  "editor-save",
] as const;

export type InstantScenario = (typeof instantScenarios)[number];

export const instantArtifactFixture = Effect.fn("instantArtifactFixture")(
  function* instantArtifactFixture(scenario: InstantScenario) {
    const h = yield* instantRuntimeFixture({
      operation: scenario === "editor-save" ? "save" : "delete",
      organizer: scenario !== "meeting-delete",
      recurring: scenario === "repeat-delete",
      undo: false,
    });

    if (scenario === "readonly-delete") {
      yield* Ref.update(h.state, (model) => ({
        ...model,
        calendar: {
          ...model.calendar,
          calendars: model.calendar.calendars.map((calendar) => ({
            ...calendar,
            accessRole: "reader" as const,
            primary: false,
            title: "Work",
          })),
          reads: model.calendar.reads.map((read) => ({
            ...read,
            events: RemoteEvents.Success({
              data: {
                events: [
                  {
                    ...h.source,
                    attendees: [
                      {
                        email: "owner@example.test",
                        responseStatus: "accepted",
                        self: true,
                      },
                      { email: "guest@example.test" },
                    ],
                    title: "Design review",
                  },
                ],
                versions: [],
              },
            }),
          })),
        },
      }));
    }

    if (scenario === "editor-save") {
      yield* h.dispatch(
        Message.EditingAction({ action: EditorAction.cases.OpenEdit.make({}) })
      );
      yield* nextInstantNotice(
        h.queue,
        (notice) =>
          EditingNotice.guards.Editor(notice) &&
          EditorView.guards.Editing(notice.view)
      );
      yield* h.dispatch(
        Message.EditingAction({
          action: EditorAction.cases.TextEdited.make({
            field: "endTime",
            value: "12:00",
          }),
        })
      );
      yield* nextInstantNotice(
        h.queue,
        (notice) =>
          EditingNotice.guards.Editor(notice) &&
          EditorView.guards.Editing(notice.view) &&
          notice.view.draft.endTime === "12:00"
      );
      yield* h.dispatch(
        Message.EditingAction({
          action: EditorAction.cases.TextEdited.make({
            field: "startTime",
            value: "11:00",
          }),
        })
      );
      yield* nextInstantNotice(
        h.queue,
        (notice) =>
          EditingNotice.guards.Editor(notice) &&
          EditorView.guards.Editing(notice.view) &&
          notice.view.draft.startTime === "11:00"
      );
    }

    const before = yield* Ref.get(h.state);

    const row = keyboardRegistry.find(
      (entry) =>
        entry.id ===
        (scenario === "editor-save" ? "save-no-email" : "delete-no-email")
    );

    const target = document.createElement(
      scenario === "editor-save" ? "textarea" : "button"
    );

    let observed = Option.none<ReturnType<typeof Message.PressedCalendarKey>>();
    target.addEventListener(
      "keydown",
      (event) => {
        if (!(event instanceof KeyboardEvent)) {
          return;
        }

        const message = keyboardMessage(
          before,
          event,
          before.calendar.now,
          "Win32"
        );

        if (
          Option.isSome(message) &&
          Predicate.isTagged(message.value, "PressedCalendarKey")
        ) {
          observed = Option.some(message.value);
        }
      },
      { once: true }
    );
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: scenario === "editor-save" ? "Enter" : "Delete",
        shiftKey: true,
      })
    );
    let prepared = Option.none<typeof WritePlan.Type>();

    if (Option.isSome(observed)) {
      yield* h.dispatch(observed.value);

      const complete = yield* nextInstantNotice(
        h.queue,
        (notice) =>
          EditingNotice.guards.Editor(notice) &&
          Option.isSome(notice.mutation) &&
          (scenario === "editor-save"
            ? EditorMutation.guards.Saved(notice.mutation.value)
            : EditorMutation.guards.DeletedStaged(notice.mutation.value))
      );

      if (EditingNotice.guards.Editor(complete)) {
        prepared = complete.plan;

        if (
          Option.isSome(complete.mutation) &&
          EditorMutation.guards.Saved(complete.mutation.value)
        ) {
          const current = yield* Ref.get(h.state);
          const accepted = complete.mutation.value.event;

          const prior = current.calendar.reads.flatMap((read) =>
            Option.toArray(AsyncData.getData(read.events)).flatMap(
              (data) => data.events
            )
          );

          yield* h.dispatch(
            Message.ReceivedEvents({
              accountId: accepted.accountId,
              request: current.calendar.rangeRequest,
              result: {
                events: prior.map((event) =>
                  event.eventId === accepted.eventId ? accepted : event
                ),
                versions: [
                  {
                    accountId: accepted.accountId,
                    calendarId: accepted.calendarId,
                    version: 2,
                  },
                ],
              },
            })
          );
        }
      }
    }

    const after = yield* Ref.get(h.state);
    const requests = yield* Ref.get(h.api.fake.requests);

    const data = before.calendar.reads.flatMap((read) =>
      Option.toArray(AsyncData.getData(read.events))
    );

    const event = data
      .flatMap((result) => result.events)
      .find((source) => source.eventId === h.source.eventId);

    const calendar = before.calendar.calendars.find(
      (item) =>
        item.accountId === event?.accountId &&
        item.calendarId === event.calendarId
    );

    const plan = Option.getOrUndefined(prepared);

    const evidence = {
      availability: row?.availability(before),
      calendar,
      companions: data
        .flatMap((result) => result.events)
        .filter(
          (item) =>
            item.eventId !== event?.eventId &&
            item.recurringEventId === event?.recurringEventId
        )
        .map((item) => ({ event: item, key: eventKey(item) })),
      dialogsSeen: h.views.filter((tag) =>
        ["Email", "Scope", "RemoveRecurrence"].includes(tag)
      ),
      editorAfter: after.editing.view._tag,
      editorBefore: before.editing.view._tag,
      keyHandled: Option.isSome(observed),
      loaded: data.length > 0,
      mutations: requests
        .filter((request) => request.method !== "GET")
        .map((request) => ({
          body: request.body,
          method: request.method,
          path: request.path,
        })),
      pending: after.editing.deletes
        .filter((mark) => mark.phase === "pending")
        .map((mark) => ({ id: mark.intent.id, request: mark.intent.request })),
      prepared:
        plan === undefined
          ? null
          : {
              emailNeeded: plan.emailNeeded,
              intent: plan.session.intent,
              master: Option.getOrUndefined(plan.session.master),
              scope: plan.scope,
              sendUpdates: plan.sendUpdates,
            },
      readCompleted: after.calendar.reads.every((read) =>
        AsyncData.isSuccess(read.events)
      ),
      savedNotice: Option.getOrUndefined(after.editing.instantSaved),
      scenario,
      selected: before.calendar.selected,
      source: event,
      unchanged: JSON.stringify(before) === JSON.stringify(after),
    };

    return {
      before,
      evidence,
      model: {
        ...after,
        upcoming: {
          ...after.upcoming,
          data: RemoteEvents.Success({ data: { events: [], versions: [] } }),
        },
      },
      prepared,
    };
  }
);

import { CalendarEvent, Provider } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import {
  DeleteIntent,
  DeleteOutcome,
} from "../src/client/editing/delete-actor.js";
import { DeleteNotice } from "../src/client/editing/deletion-session.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import {
  EditorMutation,
  LoadedEditor,
} from "../src/client/editing/editor-session-model.js";
import { prepareEditor } from "../src/client/editing/prepare-editor.js";
import { EditingNotice } from "../src/client/editing/runtime.js";
import { eventDraft } from "../src/layout/editor-draft.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { fixtureEvents, fixtureSelection } from "./fixture.js";

const model = () => ({
  ...fixtureSelection(),
  person: Option.some("fixture-person"),
});

const sourceEvent = Schema.decodeUnknownSync(CalendarEvent)({
  ...fixtureEvents[0],
  organizer: { self: true },
});

const intent = DeleteIntent.make({
  event: sourceEvent,
  id: "delete-fixture",
  navigation: model().calendar.navigation,
  request: {
    accountId: sourceEvent.accountId,
    calendarId: sourceEvent.calendarId,
    eventId: sourceEvent.eventId,
    scope: "single",
    sendUpdates: "none",
  },
  selection: model().calendar.selected,
  title: sourceEvent.title ?? "Event",
});

const deliver = (
  current: ReturnType<typeof model>,
  notice: typeof EditingNotice.Type
) =>
  update(
    current,
    Message.ReceivedEditing({ notice, personId: "fixture-person" })
  );

it.effect(
  "pending deletion remains hidden across a fresh provider range and Undo restores it",
  () =>
    Effect.sync(() => {
      const pending = deliver(
        model(),
        EditingNotice.cases.Delete.make({
          notice: DeleteNotice.cases.Changed.make({
            intent,
            keepalive: false,
            phase: "pending",
          }),
        })
      ).model;

      expect(
        visibleEvents(pending).some(
          (event) => event.source.eventId === sourceEvent.eventId
        )
      ).toBe(false);

      const repeated = update(
        pending,
        Message.ReceivedEvents({
          accountId: sourceEvent.accountId,
          request: pending.calendar.rangeRequest,
          result: {
            events: fixtureEvents.filter(
              (event) => event.accountId === sourceEvent.accountId
            ),
            versions: [],
          },
        })
      ).model;

      expect(
        visibleEvents(repeated).some(
          (event) => event.source.eventId === sourceEvent.eventId
        )
      ).toBe(false);

      const restored = deliver(
        repeated,
        EditingNotice.cases.Delete.make({
          notice: DeleteNotice.cases.Settled.make({
            intent,
            outcome: DeleteOutcome.cases.Undone.make({ id: intent.id }),
          }),
        })
      ).model;

      expect(restored.editing.deletes).toHaveLength(0);
      expect(restored.calendar.selected).toEqual(intent.selection);
      expect(restored.calendar.navigation).toEqual(intent.navigation);
    })
);

it.effect(
  "typed delete rejection removes the optimistic mask rather than preserving a false success",
  () =>
    Effect.sync(() => {
      const pending = deliver(
        model(),
        EditingNotice.cases.Delete.make({
          notice: DeleteNotice.cases.Changed.make({
            intent,
            keepalive: false,
            phase: "pending",
          }),
        })
      ).model;

      const failure = new Provider({
        message: "Fixture permission refused",
        operation: "deleteEvent",
        status: 403,
      });

      const rejected = deliver(
        pending,
        EditingNotice.cases.Delete.make({
          notice: DeleteNotice.cases.Settled.make({
            intent,
            outcome: DeleteOutcome.cases.Failed.make({
              failure,
              id: intent.id,
            }),
          }),
        })
      ).model;

      expect(
        visibleEvents(rejected).some(
          (event) => event.source.eventId === sourceEvent.eventId
        )
      ).toBe(true);
      expect(Option.isSome(rejected.error)).toBe(true);
    })
);

it.effect(
  "a successful write retains its projection until the fresh range arrives, while a rejected write rolls back",
  () =>
    Effect.gen(function* writeProjection() {
      const base = model();

      const baseline = yield* eventDraft(
        sourceEvent,
        undefined,
        base.calendar.zone
      );

      const session = LoadedEditor.make({
        baseline,
        calendars: base.calendar.calendars.map((calendar) => ({
          ...calendar,
          accessRole: "owner",
        })),
        createId: Option.none(),
        draft: { ...baseline, title: "Optimistic title" },
        id: "edit-fixture",
        kind: "edit",
        master: Option.none(),
        moveSupport: "notAvailable",
        navigation: base.calendar.navigation,
        operation: "save",
        original: Option.some(sourceEvent),
        selection: base.calendar.selected,
      });

      const plan = yield* prepareEditor(session);

      const view = EditorView.cases.Saving.make({
        draft: session.draft,
        error: Option.none(),
        kind: session.kind,
        moveSupport: session.moveSupport,
        operation: session.operation,
        original: session.original,
        permissions: {
          calendarWritable: true,
          editGuests: true,
          editMeeting: true,
          inviteGuests: true,
        },
      });

      const saving = deliver(
        base,
        EditingNotice.cases.Editor.make({
          error: Option.none(),
          mutation: Option.none(),
          plan: Option.some(plan),
          saving: true,
          view,
        })
      ).model;

      expect(
        visibleEvents(saving).find(
          (event) => event.source.eventId === sourceEvent.eventId
        )?.title
      ).toBe("Optimistic title");

      const rejected = deliver(
        saving,
        EditingNotice.cases.Editor.make({
          error: Option.some("Rejected"),
          mutation: Option.none(),
          plan: Option.some(plan),
          saving: false,
          view: EditorView.cases.Closed.make({}),
        })
      ).model;

      expect(
        visibleEvents(rejected).find(
          (event) => event.source.eventId === sourceEvent.eventId
        )?.title
      ).toBe(sourceEvent.title);
      const event = { ...sourceEvent, title: "Optimistic title" };

      const acknowledged = deliver(
        saving,
        EditingNotice.cases.Editor.make({
          error: Option.none(),
          mutation: Option.some(
            EditorMutation.cases.Saved.make({ event, id: session.id, plan })
          ),
          plan: Option.some(plan),
          saving: false,
          view: EditorView.cases.Closed.make({}),
        })
      ).model;

      expect(
        visibleEvents(acknowledged).find(
          (item) => item.source.eventId === sourceEvent.eventId
        )?.title
      ).toBe("Optimistic title");

      const fresh = update(
        acknowledged,
        Message.ReceivedEvents({
          accountId: sourceEvent.accountId,
          request: acknowledged.calendar.rangeRequest,
          result: { events: [event], versions: [] },
        })
      ).model;

      expect(Option.isNone(fresh.editing.write)).toBe(true);
      expect(
        visibleEvents(fresh).find(
          (item) => item.source.eventId === sourceEvent.eventId
        )?.title
      ).toBe("Optimistic title");
    })
);

it.effect(
  "old-person editing notices cannot mutate the new person's model",
  () =>
    Effect.sync(() => {
      const current = { ...model(), person: Option.some("different-person") };

      const result = update(
        current,
        Message.ReceivedEditing({
          notice: EditingNotice.cases.Delete.make({
            notice: DeleteNotice.cases.Changed.make({
              intent,
              keepalive: false,
              phase: "pending",
            }),
          }),
          personId: "fixture-person",
        })
      );

      expect(result.model).toBe(current);
    })
);

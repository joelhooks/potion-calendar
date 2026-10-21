import {
  Calendar,
  CalendarEvent,
  Provider,
  SeriesMoveRetimePartial,
  SeriesMoveRetimeUncertain,
} from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { Message, update } from "../src/client/app.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { LoadedEditor } from "../src/client/editing/editor-session-model.js";
import {
  permissionsForEditor,
  prepareEditor,
} from "../src/client/editing/prepare-editor.js";
import { EditingNotice } from "../src/client/editing/runtime.js";
import { eventDraft } from "../src/layout/editor-draft.js";
import { primarySelection } from "../src/layout/selection-set.js";
import { fixtureEvents, fixtureSelection } from "./fixture.js";

it.effect.each(["partial", "uncertain"])(
  "a %s result rereads source and hidden destination once without replaying the write",
  (kind) =>
    Effect.gen(function* recoveryRead() {
      const initial = fixtureSelection();

      const calendars = initial.calendar.calendars.map((calendar) =>
        Calendar.make({
          ...calendar,
          accessRole:
            calendar.calendarId === "hidden" ? "writer" : calendar.accessRole,
        })
      );

      const model = {
        ...initial,
        calendar: { ...initial.calendar, calendars },
      };

      const original = yield* Effect.fromNullishOr(fixtureEvents[0]);

      const event = CalendarEvent.make({
        ...original,
        organizer: { self: true },
      });

      const baseline = yield* eventDraft(event, undefined, model.calendar.zone);

      const session = LoadedEditor.make({
        baseline,
        calendars,
        createId: Option.none(),
        draft: { ...baseline, calendarId: "hidden" },
        id: "recovery-fixture",
        kind: "edit",
        master: Option.none(),
        moveSupport: "available",
        navigation: model.calendar.navigation,
        operation: "save",
        original: Option.some(event),
        selection: primarySelection(model.calendar.selected),
      });

      const plan = yield* prepareEditor(session);

      const cause = new Provider({
        message: "Fixture outcome",
        operation: "moveEvent",
        status: 503,
      });

      const failure =
        kind === "partial"
          ? new SeriesMoveRetimePartial({
              cause,
              changes: {
                end: { dateTime: "2026-10-19T18:00:00Z" },
                start: { dateTime: "2026-10-19T17:00:00Z" },
              },
              completedStep: "move",
              movedEvent: {
                ...event,
                calendarId: "hidden",
                eventId: "moved-master",
              },
              retimeOutcome: "unknown",
            })
          : new SeriesMoveRetimeUncertain({
              cause,
              destination: { accountId: "work", calendarId: "hidden" },
              source: event,
            });

      const view = EditorView.cases.Failure.make({
        draft: session.draft,
        error: Option.none(),
        failure,
        kind: session.kind,
        moveSupport: session.moveSupport,
        operation: session.operation,
        original: session.original,
        permissions: permissionsForEditor(session),
      });

      const message = Message.ReceivedEditing({
        notice: EditingNotice.cases.Editor.make({
          error: Option.none(),
          mutation: Option.none(),
          plan: Option.some(plan),
          saving: false,
          view,
        }),
        personId: "fixture-person",
      });

      const first = update(model, message);
      expect(
        first.commands?.every((command) => command.name === "ReadEvents")
      ).toBe(true);
      expect(
        first.commands?.find(
          (command) =>
            command.name === "ReadEvents" && command.args?.accountId === "work"
        )?.args?.calendars
      ).toEqual(
        expect.arrayContaining([
          { accountId: "work", calendarId: "primary" },
          { accountId: "work", calendarId: "hidden" },
        ])
      );
      expect(
        Option.isNone(primarySelection(first.model.calendar.selected))
      ).toBe(true);
      expect(Option.getOrThrow(first.model.error)).toContain("confirm");
      const repeated = update(first.model, message);
      expect(repeated.commands).toBeUndefined();
      expect(repeated.model.calendar.rangeRequest).toBe(
        first.model.calendar.rangeRequest
      );
    })
);

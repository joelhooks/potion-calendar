import {
  Calendar,
  CalendarEvent,
  Provider,
  SeriesMoveRetimePartial,
} from "@calendar/calendar/contracts";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, reloadRange, update } from "../src/client/app.js";
import {
  RemoteCalendars,
  calendarKey,
  eventKey,
} from "../src/client/calendar-state.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { gestureTarget } from "../src/client/editing/gesture-input.js";
import { GesturePoint } from "../src/client/editing/gesture-model.js";
import { view } from "../src/features/app.js";
import { eventDraft } from "../src/layout/editor-draft.js";
import { gestureRange } from "../src/layout/gesture-range.js";
import { dayFromIso } from "../src/layout/navigation.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { editorViewFields, renderEditorFixture } from "./editor-fixture.js";
import { fixtureEvents, fixtureIndex, fixtureSelection } from "./fixture.js";

const day = dayFromIso("2026-10-19");

const point = (minute: number) =>
  GesturePoint.make({
    alt: false,
    at: 100,
    day,
    minute,
    pointerId: 1,
    shift: false,
    x: 150,
    y: minute,
  });

it.effect(
  "exports actual drag-create, move, resize previews and enabled calendar movement for fenced captures",
  () =>
    Effect.gen(function* gestureArtifacts() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      const source = yield* Schema.decodeUnknownEffect(CalendarEvent)(
        fixtureEvents[0]
      );

      const event = CalendarEvent.make({
        ...source,
        guestsCanModify: true,
        organizer: { self: true },
      });

      const snapshot = fixtureSelection();

      const inventory = {
        accounts: fixtureIndex.accounts.map((account) =>
          "calendars" in account
            ? {
                ...account,
                calendars: account.calendars.map((calendar) =>
                  Calendar.make({
                    ...calendar,
                    accessRole:
                      calendar.calendarId === "hidden" &&
                      calendar.accountId === "work"
                        ? "writer"
                        : calendar.accessRole,
                  })
                ),
              }
            : account
        ),
      };

      const initial = {
        ...snapshot,
        calendar: {
          ...snapshot.calendar,
          calendars: inventory.accounts.flatMap((account) =>
            "calendars" in account ? account.calendars : []
          ),
          index: RemoteCalendars.Success({ data: inventory }),
        },
      };

      const { model } = update(
        initial,
        Message.ReceivedEvents({
          accountId: event.accountId,
          request: initial.calendar.rangeRequest,
          result: {
            events: fixtureEvents
              .filter((item) => item.accountId === event.accountId)
              .map((item) => (item.eventId === event.eventId ? event : item)),
            versions: [],
          },
        })
      );

      const selected = yield* Effect.fromNullishOr(
        visibleEvents(model).find(
          (item) => item.source.eventId === event.eventId
        )
      );

      const target = gestureTarget(selected, model.calendar.zone);

      const scenarios = [
        {
          name: "drag-create",
          preview: gestureRange(
            {
              allDay: false,
              edge: "body",
              point: point(750),
              target: Option.none(),
            },
            point(840),
            1
          ),
        },
        {
          name: "drag-move",
          preview: gestureRange(
            { allDay: false, edge: "body", point: point(540), target },
            point(660),
            1
          ),
        },
        {
          name: "resize",
          preview: gestureRange(
            { allDay: false, edge: "end", point: point(600), target },
            point(660),
            1
          ),
        },
      ];

      for (const scenario of scenarios) {
        const previewModel = {
          ...model,
          calendar: {
            ...model.calendar,
            selected: Option.some(eventKey(event)),
          },
          editing: { ...model.editing, gesture: Option.some(scenario.preview) },
        };

        const rendered = yield* renderToString(
          { init: () => ({ model: previewModel }), view },
          { isHydratable: false }
        );

        const document = new DOMParser().parseFromString(
          rendered.html,
          "text/html"
        );

        expect(document.querySelector(".gesture-preview")).not.toBeNull();

        const { range } = scenario.preview;

        const proposed = CalendarEvent.make({
          ...event,
          end: { dateTime: `${range.endDate}T${range.endTime}:00-07:00` },
          eventId: "proposed-range",
          start: { dateTime: `${range.startDate}T${range.startTime}:00-07:00` },
        });

        const proposedModel = update(
          model,
          Message.ReceivedEvents({
            accountId: proposed.accountId,
            request: model.calendar.rangeRequest,
            result: { events: [proposed], versions: [] },
          })
        ).model;

        const proposedRender = yield* renderToString(
          { init: () => ({ model: proposedModel }), view },
          { isHydratable: false }
        );

        const proposedDocument = new DOMParser().parseFromString(
          proposedRender.html,
          "text/html"
        );

        const chip = [
          ...proposedDocument.querySelectorAll<HTMLElement>(".event-chip"),
        ].find((element) => element.dataset.eventKey === eventKey(proposed));

        expect(
          document.querySelector(".gesture-preview span")?.textContent
        ).toBe(chip?.querySelector(".event-time")?.textContent);
        expect(chip?.querySelector(".event-time")).not.toBeNull();
        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${scenario.name}</title><style>${css}</style></head><body>${rendered.html}<script>const viewport=document.querySelector('#time-viewport');if(viewport){viewport.scrollTop=420}document.documentElement.dataset.fixtureReady='gesture';</script></body></html>`;
        yield* fs.writeFileString(
          `../../.git/editing-${scenario.name}-fixture.html`,
          html
        );
      }

      const draft = yield* eventDraft(event, undefined, model.calendar.zone);

      const moved = EditorView.cases.Editing.make({
        ...editorViewFields,
        draft: { ...draft, calendarId: "hidden" },
        moveSupport: "available",
        original: Option.some(event),
      });

      const editor = yield* renderEditorFixture(
        moved,
        model.calendar.calendars
      );

      const document = new DOMParser().parseFromString(
        editor.html,
        "text/html"
      );

      const select =
        document.querySelector<HTMLSelectElement>("#event-calendar");

      expect(select?.disabled).toBe(false);
      expect(select?.value).toBe(calendarKey("work", "hidden"));

      const base = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Calendar movement</title><style>${css}</style></head><body>${base.html}${editor.html}<script>document.querySelectorAll('dialog').forEach(dialog=>dialog.showModal());document.documentElement.dataset.fixtureReady='gesture';</script></body></html>`;
      yield* fs.writeFileString(
        "../../.git/editing-calendar-move-fixture.html",
        html
      );

      const failure = new SeriesMoveRetimePartial({
        cause: new Provider({
          message: "Time update refused",
          operation: "updateEvent",
          status: 403,
        }),
        changes: {
          end: {
            dateTime: "2026-10-19T18:00:00.000Z",
            timeZone: model.calendar.zone,
          },
          start: {
            dateTime: "2026-10-19T17:00:00.000Z",
            timeZone: model.calendar.zone,
          },
        },
        completedStep: "move",
        movedEvent: CalendarEvent.make({
          ...event,
          calendarId: "hidden",
          eventId: "destination-master",
          recurrence: ["RRULE:FREQ=WEEKLY"],
        }),
        retimeOutcome: "rejected",
      });

      const recovery = yield* renderEditorFixture(
        EditorView.cases.Failure.make({
          ...editorViewFields,
          draft: moved.draft,
          failure,
          moveSupport: moved.moveSupport,
          original: moved.original,
        }),
        model.calendar.calendars
      );

      const recoveryDocument = new DOMParser().parseFromString(
        recovery.html,
        "text/html"
      );

      expect(recoveryDocument.body.textContent).toContain(
        "Moved to Shared calendar, but the time wasn't changed."
      );
      expect(
        recoveryDocument.querySelector("button[type=submit]")?.textContent
      ).toBe("Close");
      expect(recoveryDocument.querySelector("#event-title")).toBeNull();
      expect(
        recoveryDocument.querySelectorAll(".editor-footer button")
      ).toHaveLength(1);
      expect(recoveryDocument.body.textContent).not.toContain("Try again");
      expect(recoveryDocument.body.textContent).not.toContain("Cancel");

      const refreshing = reloadRange({
        ...model,
        calendar: { ...model.calendar, selected: Option.none() },
      }).model;

      const recoveryBase = yield* renderToString(
        { init: () => ({ model: refreshing }), view },
        { isHydratable: false }
      );

      const recoveryHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Partial series move</title><style>${css}</style></head><body>${recoveryBase.html}${recovery.html}<script>document.querySelectorAll('dialog').forEach(dialog=>dialog.showModal());document.documentElement.dataset.fixtureReady='gesture';</script></body></html>`;
      yield* fs.writeFileString(
        "../../.git/editing-partial-outcome-fixture.html",
        recoveryHtml
      );
    }).pipe(Effect.provide(NodeServices.layer))
);

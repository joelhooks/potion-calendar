import type { CalendarEventValue } from "@calendar/calendar/contracts";
import {
  DesktopAction,
  TrayRsvpNote,
  desktopWire,
  defaultDesktopPreferences,
  trayRsvpNoteToken,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Option, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import {
  calendarKey,
  eventKey,
  RemoteEvents,
} from "../src/client/calendar-state.js";
import { DesktopNotice } from "../src/client/desktop/model.js";
import { FocusRsvpNote } from "../src/client/desktop/rsvp-note.js";
import { desktopSelection } from "../src/client/desktop/selection.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { PreparedRsvpNote } from "../src/client/editing/rsvp-machine.js";
import {
  EditingCommand,
  EditingNotice,
} from "../src/client/editing/runtime.js";
import { view } from "../src/features/app.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { responseLabel } from "../src/layout/response-label.js";
import {
  savedUpcomingEvent,
  upcomingFixture,
  upcomingPerson,
} from "./upcoming-fixture.js";

const event: CalendarEventValue = {
  ...savedUpcomingEvent,
  attendees: [
    { email: "self@example.test", responseStatus: "needsAction", self: true },
  ],
  eventId: "series_20261021T090000Z",
  recurringEventId: "series",
};

const responses: readonly (typeof TrayRsvpNote.Type)["response"][] = [
  "accepted",
  "declined",
  "tentative",
];

const start = DateTime.toEpochMillis(
  DateTime.makeUnsafe("2026-10-21T09:00:00Z")
);

const key = {
  accountId: event.accountId,
  calendarId: event.calendarId,
  eventId: event.eventId,
};

const intent = TrayRsvpNote.make({
  key,
  lease: "lease",
  personId: upcomingPerson,
  response: "accepted",
  start,
});

const loaded = (
  width = 1280,
  events: readonly CalendarEventValue[] = [event]
): AppModel => {
  const base = upcomingFixture();

  const upcoming = update(
    base,
    Message.ReceivedUpcoming({
      personId: upcomingPerson,
      request: base.upcoming.request,
      result: { events, versions: [] },
    })
  ).model;

  const settings = update(
    upcoming,
    Message.ReceivedDesktop({
      notice: DesktopNotice.cases.Settings.make({
        settings: {
          issues: [],
          openAtLogin: false,
          preferences: defaultDesktopPreferences(),
          revision: 1,
          runtime: { notificationLease: "lease", prompt: true, tray: true },
        },
      }),
    })
  ).model;

  const rows = update(
    settings,
    Message.ReceivedEvents({
      accountId: event.accountId,
      request: settings.calendar.rangeRequest,
      result: { events, versions: [] },
    })
  ).model;

  return {
    ...rows,
    calendar: { ...rows.calendar, viewportWidth: width },
    phoneShell: { ...rows.phoneShell, viewportWidth: width },
  };
};

const request = (value: typeof TrayRsvpNote.Type) =>
  Message.ReceivedDesktop({
    notice: DesktopNotice.cases.Action.make({
      action: Schema.decodeSync(desktopWire.action)(
        Schema.encodeSync(desktopWire.action)(
          DesktopAction.cases.PrepareRsvpNote.make(value)
        )
      ),
    }),
  });

const commandArgs = Schema.Struct({
  command: EditingCommand,
  personId: Schema.String,
});

const preparedModel = (
  model: AppModel,
  value: typeof TrayRsvpNote.Type = intent
) =>
  update(
    model,
    Message.ReceivedEditing({
      notice: EditingNotice.cases.Rsvp.make({
        view: {
          ...model.editing.rsvp,
          focused: Option.some(event),
          prepared: PreparedRsvpNote.make({ id: 1, intent: value }),
        },
      }),
      personId: upcomingPerson,
    })
  );

it.effect.each(responses)(
  "shared %s action stages without dispatching a response write",
  (response) =>
    Effect.gen(function* stagedIntent() {
      const model = loaded();
      const value = { ...intent, response };
      const result = update(model, request(value));
      expect(result.model.calendar).toBe(model.calendar);
      expect(result.commands?.map((command) => command.name)).toEqual([
        "DispatchEditing",
      ]);

      const args = yield* Schema.decodeUnknownEffect(commandArgs)(
        result.commands?.[0]?.args
      );

      expect(args).toEqual({
        command: EditingCommand.cases.RsvpPrepare.make({
          event,
          intent: value,
          selectionKey: Option.getOrThrow(
            Option.fromUndefinedOr(desktopSelection(model, value.key))
          ).key,
        }),
        personId: upcomingPerson,
      });
      const admitted = preparedModel(result.model, value);
      expect(
        visibleEvents(admitted.model)
          .find((item) => item.selected)
          ?.copies.map((copy) => eventKey(copy.source))
      ).toContain(eventKey(event));
      expect(
        admitted.commands?.filter((command) => command.name === "FocusRsvpNote")
      ).toHaveLength(1);

      const rendered = yield* renderToString(
        { init: () => ({ model: admitted.model }), view },
        { isHydratable: false }
      );

      const dom = new DOMParser().parseFromString(rendered.html, "text/html");

      const field = dom.querySelector<HTMLTextAreaElement>(
        "textarea[data-tray-rsvp-note]"
      );

      expect(field?.dataset.trayRsvpNote).toBe(trayRsvpNoteToken(value, 1));
      expect(field?.value).toBe("");
      expect(
        dom.querySelector(".event-rsvp [role='status']")?.textContent
      ).toContain(`Choose ${responseLabel(response)} to send.`);
      expect(
        [...dom.querySelectorAll(".event-rsvp button")].every(
          (button) => button.getAttribute("aria-pressed") === "false"
        )
      ).toBe(true);

      const edited = update(
        admitted.model,
        Message.EditingAction({
          action: EditorAction.cases.RsvpNoteEdited.make({
            value: "Typed note",
          }),
        })
      );

      expect(
        (yield* Schema.decodeUnknownEffect(commandArgs)(
          edited.commands?.[0]?.args
        )).command
      ).toEqual(
        EditingCommand.cases.RsvpNote.make({ event, note: "Typed note" })
      );

      const sent = update(
        admitted.model,
        Message.EditingAction({
          action: EditorAction.cases.Rsvp.make({ response }),
        })
      );

      expect(
        (yield* Schema.decodeUnknownEffect(commandArgs)(
          sent.commands?.[0]?.args
        )).command
      ).toEqual(EditingCommand.cases.Rsvp.make({ event, response }));
    })
);

it.effect.each([390, 1280])(
  "admitted note opens the real details surface at %spx",
  (width) =>
    Effect.gen(function* realPane() {
      const admitted = preparedModel(loaded(width));
      expect(admitted.model.phoneShell.mode).toBe(
        width === 390 ? "details" : "closed"
      );

      const rendered = yield* renderToString(
        { init: () => ({ model: admitted.model }), view },
        { isHydratable: false }
      );

      const dom = new DOMParser().parseFromString(rendered.html, "text/html");

      const selector =
        width === 390
          ? "#phone-shell-dialog textarea[data-tray-rsvp-note]"
          : "textarea[data-tray-rsvp-note]";

      expect(dom.querySelector(selector)).not.toBeNull();
    })
);

it.effect.each([
  "person",
  "lease",
  "key",
  "start",
  "missing",
  "self",
  "busy",
  "other-draft",
])("web refuses %s without selection or send", (kind) =>
  Effect.sync(() => {
    let model = loaded();
    let value = intent;

    switch (kind) {
      case "person": {
        value = { ...intent, personId: "other" };
        break;
      }

      case "lease": {
        value = { ...intent, lease: "other" };
        break;
      }

      case "key": {
        value = { ...intent, key: { ...key, calendarId: "other" } };
        break;
      }

      case "start": {
        value = { ...intent, start: start + 1 };
        break;
      }

      case "missing": {
        model = loaded(1280, []);
        break;
      }

      case "self": {
        model = loaded(1280, [{ ...event, attendees: [] }]);
        break;
      }

      case "busy": {
        model = {
          ...model,
          editing: {
            ...model.editing,
            rsvp: {
              ...model.editing.rsvp,
              saving: Option.some({
                event,
                id: 1,
                request: { ...key, response: "accepted", sendUpdates: "none" },
              }),
            },
          },
        };
        break;
      }

      case "other-draft": {
        model = {
          ...model,
          editing: {
            ...model.editing,
            rsvp: {
              ...model.editing.rsvp,
              focused: Option.some({ ...event, eventId: "other" }),
              note: "Keep this draft",
            },
          },
        };
        break;
      }

      default: {
        throw new Error("Unknown refusal");
      }
    }

    const result = update(model, request(value));
    expect(result.commands ?? []).toEqual([]);
    expect(result.model.calendar).toBe(model.calendar);
    expect(result.model.editing.rsvp).toBe(model.editing.rsvp);
    expect(Option.isSome(result.model.error)).toBe(true);
  })
);

it.effect(
  "native admission still refuses a stale lease while explicit details response keeps its selected exact copy",
  () =>
    Effect.gen(function* retiredScope() {
      const prepared = preparedModel(loaded()).model;

      const stale = {
        ...prepared,
        desktop: { ...prepared.desktop, notificationLease: "new-lease" },
      };

      const result = update(
        stale,
        Message.EditingAction({
          action: EditorAction.cases.Rsvp.make({ response: "accepted" }),
        })
      );

      const sent = [];

      for (const command of result.commands ?? []) {
        if (command.name === "DispatchEditing") {
          const args = yield* Schema.decodeUnknownEffect(commandArgs)(
            command.args
          );

          if (EditingCommand.guards.Rsvp(args.command)) {
            sent.push(args.command);
          }
        }
      }

      expect(sent).toEqual([
        EditingCommand.cases.Rsvp.make({ event, response: "accepted" }),
      ]);
      const native = update(stale, request(intent));
      expect(Option.isSome(native.model.error)).toBe(true);

      for (const command of native.commands ?? []) {
        if (command.name === "DispatchEditing") {
          const args = yield* Schema.decodeUnknownEffect(commandArgs)(
            command.args
          );

          expect(EditingCommand.guards.RsvpPrepare(args.command)).toBe(false);
          expect(EditingCommand.guards.Rsvp(args.command)).toBe(false);
        }
      }
    })
);

it.effect.each(["phone", "desktop"])(
  "a late focus command refuses another preparation and focuses only its matching %s field",
  (pane) =>
    Effect.gen(function* staleFocus() {
      const old = Object.getOwnPropertyDescriptor(
        globalThis,
        "requestAnimationFrame"
      );

      const oldCancel = Object.getOwnPropertyDescriptor(
        globalThis,
        "cancelAnimationFrame"
      );

      const original = [...document.body.childNodes];

      const field = yield* Effect.acquireRelease(
        Effect.sync(() => {
          Object.defineProperty(globalThis, "requestAnimationFrame", {
            configurable: true,
            value: (listener: FrameRequestCallback) => {
              queueMicrotask(() => {
                listener(0);
              });

              return 1;
            },
          });
          Object.defineProperty(globalThis, "cancelAnimationFrame", {
            configurable: true,
            value: () => {},
          });
          const input = document.createElement("textarea");
          input.dataset.trayRsvpNote = "new-target";

          if (pane === "phone") {
            const dialog = document.createElement("dialog");
            dialog.id = "phone-shell-dialog";
            dialog.open = true;
            dialog.append(input);
            document.body.replaceChildren(dialog);
          } else {
            document.body.replaceChildren(input);
          }

          return input;
        }),
        () =>
          Effect.sync(() => {
            document.body.replaceChildren(...original);

            if (old === undefined) {
              Reflect.deleteProperty(globalThis, "requestAnimationFrame");
            } else {
              Object.defineProperty(globalThis, "requestAnimationFrame", old);
            }

            if (oldCancel === undefined) {
              Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
            } else {
              Object.defineProperty(
                globalThis,
                "cancelAnimationFrame",
                oldCancel
              );
            }
          })
      );

      const targetPane = pane === "phone" ? "phone" : "desktop";
      yield* FocusRsvpNote({ pane: targetPane, prepared: { id: 1, intent } })
        .effect;
      expect(document.activeElement).toBe(document.body);
      field.dataset.trayRsvpNote = trayRsvpNoteToken(intent, 1);
      yield* FocusRsvpNote({ pane: targetPane, prepared: { id: 1, intent } })
        .effect;
      expect(document.activeElement).toBe(field);
    })
);

it.effect(
  "the selected saved occurrence focuses without waiting for a range read or clearing preparation",
  () =>
    Effect.sync(() => {
      const base = loaded();

      const empty = {
        ...base,
        calendar: {
          ...base.calendar,
          reads: base.calendar.reads.map((row) => ({
            ...row,
            events: RemoteEvents.Success({
              data: { events: [], versions: [] },
            }),
          })),
        },
      };

      const admitted = preparedModel(empty);
      expect(admitted.model.editing.rsvp.prepared?.id).toBe(1);
      expect(
        admitted.commands?.filter(
          (command) => command.name === "FocusRsvpNote"
        ) ?? []
      ).toHaveLength(1);
      expect(
        admitted.commands?.filter(
          (command) => command.name === "DispatchEditing"
        ) ?? []
      ).toHaveLength(0);

      const ready = update(
        admitted.model,
        Message.ReceivedEvents({
          accountId: event.accountId,
          request: admitted.model.calendar.rangeRequest,
          result: { events: [event], versions: [] },
        })
      );

      expect(
        ready.commands?.filter((command) => command.name === "FocusRsvpNote") ??
          []
      ).toHaveLength(0);
      expect(ready.model.editing.rsvp.prepared?.id).toBe(1);
    })
);

it.effect(
  "merged details retain the requested calendar copy instead of substituting the primary",
  () =>
    Effect.gen(function* mergedDetails() {
      const primary = {
        ...event,
        eventId: "primary-copy",
        iCalUID: "shared-meeting",
      };

      const target = {
        ...event,
        calendarId: "team",
        eventId: "team_20261021T090000Z",
        iCalUID: "shared-meeting",
      };

      const base = loaded(1280, [primary, target]);

      const hidden = calendarKey("work", "primary");

      const model = {
        ...base,
        calendar: {
          ...base.calendar,
          hidden: [hidden],
          mergeDuplicates: true,
          visibility: { ...base.calendar.visibility, [hidden]: false },
        },
      };

      const value = {
        ...intent,
        key: {
          accountId: target.accountId,
          calendarId: target.calendarId,
          eventId: target.eventId,
        },
      };

      const staged = update(model, request(value));
      expect(
        (yield* Schema.decodeUnknownEffect(commandArgs)(
          staged.commands?.[0]?.args
        )).command
      ).toEqual(
        EditingCommand.cases.RsvpPrepare.make({
          event: target,
          intent: value,
          selectionKey: Option.getOrThrow(
            Option.fromUndefinedOr(desktopSelection(model, value.key))
          ).key,
        })
      );

      const admitted = update(
        staged.model,
        Message.ReceivedEditing({
          notice: EditingNotice.cases.Rsvp.make({
            view: {
              ...staged.model.editing.rsvp,
              focused: Option.some(target),
              prepared: { id: 1, intent: value },
            },
          }),
          personId: upcomingPerson,
        })
      ).model;

      const sent = update(
        admitted,
        Message.EditingAction({
          action: EditorAction.cases.Rsvp.make({ response: "accepted" }),
        })
      );

      expect(
        (yield* Schema.decodeUnknownEffect(commandArgs)(
          sent.commands?.[0]?.args
        )).command
      ).toEqual(
        EditingCommand.cases.Rsvp.make({ event: target, response: "accepted" })
      );
    })
);

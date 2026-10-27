import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { trayRsvpNoteToken } from "@calendar/core/desktop-bridge";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message } from "../src/client/app.js";
import { rsvpNoteTarget } from "../src/client/desktop/rsvp-note.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { responseIsBusy } from "../src/client/editing/response-availability.js";
import { view } from "../src/features/app.js";
import { visibleEvents } from "../src/layout/presentation.js";
import {
  RecoveryBusy,
  recoveryAdmission,
  recoveryBusyMessage,
  recoveryEnd,
  recoveryEvent,
  recoveryHost,
  recoveryIntent,
  recoveryInteraction,
  recoveryModel,
} from "./tray-note-recovery-fixture.js";
import { upcomingPerson } from "./upcoming-fixture.js";

it.effect.each([1280, 390])(
  "the real %s root crosses meeting end without losing text, moving selection or sending before confirmation",
  (width) =>
    Effect.gen(function* rootExpiry() {
      const h = yield* recoveryHost(recoveryModel(width));
      yield* h.apply(recoveryAdmission());
      expect((yield* h.receive()).prepared).toBeDefined();
      yield* h.apply(
        Option.getOrThrow(
          recoveryInteraction(h.model(), "type", "Keep this note")
        )
      );
      yield* h.receive();
      expect((yield* h.receive()).note).toBe("Keep this note");
      const selection = h.model().calendar.selected;
      expect(yield* h.apply(Message.Ticked({ now: recoveryEnd - 1 }))).toBe(0);
      expect(h.model().editing.rsvp.prepared).toBeDefined();

      const focusRequests = h.effects.filter(
        (name) => name === "FocusRsvpNote"
      ).length;

      yield* h.apply(Message.Ticked({ now: recoveryEnd }));
      const retired = yield* h.receive();
      expect(retired.prepared).toBeUndefined();
      expect(retired.draftTarget?._tag).toBe("DetailsDraft");
      expect(retired.note).toBe("Keep this note");
      expect(yield* h.apply(Message.Ticked({ now: recoveryEnd + 1 }))).toBe(0);
      expect(h.model().calendar.selected).toEqual(selection);
      expect(h.effects.filter((name) => name === "FocusRsvpNote")).toHaveLength(
        focusRequests
      );
      expect(h.calls).toHaveLength(0);

      for (const text of ["Keep this note after end", "", "Restored note"]) {
        expect(
          yield* h.apply(
            Option.getOrThrow(recoveryInteraction(h.model(), "type", text))
          )
        ).toBe(1);
        yield* h.receive();
        expect((yield* h.receive()).note).toBe(text);
        expect(h.calls).toHaveLength(0);
      }

      const rendered = yield* renderToString(
        { init: () => ({ model: h.model() }), view },
        { isHydratable: false }
      );

      const dom = new DOMParser().parseFromString(rendered.html, "text/html");
      expect(dom.querySelector("[data-tray-rsvp-note]")).toBeNull();
      expect(rendered.html).not.toContain("Add a note for");
      expect(
        dom.querySelector<HTMLTextAreaElement>(
          width === 390 ? "#phone-shell-dialog #rsvp-note" : "#rsvp-note"
        )?.value
      ).toBe("Restored note");
      yield* h.apply(
        Option.getOrThrow(recoveryInteraction(h.model(), "click", "Maybe"))
      );
      yield* h.receive();
      yield* h.receive();
      yield* h.receive();
      expect(h.calls).toEqual([
        {
          accountId: recoveryEvent.accountId,
          calendarId: recoveryEvent.calendarId,
          eventId: recoveryEvent.eventId,
          note: "Restored note",
          response: "tentative",
          sendUpdates: "none",
        },
      ]);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
);

it.effect.each([
  { missing: false, width: 1280 },
  { missing: true, width: 1280 },
  { missing: false, width: 390 },
  { missing: true, width: 390 },
])("merged exact-copy root recovery %j", ({ width, missing }) =>
  Effect.gen(function* missingCopy() {
    const primary: CalendarEventValue = {
      ...recoveryEvent,
      attendees: [
        { email: "self@example.test", responseStatus: "declined", self: true },
      ],
      eventId: "primary-copy",
      iCalUID: "recovery-shared",
      originalStartTime: { dateTime: "2026-10-21T09:00:00Z" },
    };

    const target: CalendarEventValue = {
      ...recoveryEvent,
      calendarId: "team",
      eventId: "team_20261021T090000Z",
      iCalUID: "recovery-shared",
      originalStartTime: { dateTime: "2026-10-21T09:00:00Z" },
    };

    const base = recoveryModel(width, [primary, target]);

    const h = yield* recoveryHost({
      ...base,
      calendar: {
        ...base.calendar,
        hideDeclined: false,
        mergeDuplicates: true,
      },
    });

    const intent = {
      ...recoveryIntent,
      key: {
        accountId: target.accountId,
        calendarId: target.calendarId,
        eventId: target.eventId,
      },
    };

    yield* h.apply(recoveryAdmission(intent));
    expect((yield* h.receive()).prepared?.intent.key).toEqual(intent.key);
    yield* h.apply(
      Option.getOrThrow(
        recoveryInteraction(h.model(), "type", "Keep the team copy")
      )
    );
    yield* h.receive();
    yield* h.receive();
    yield* h.apply(Message.Ticked({ now: recoveryEnd }));
    yield* h.receive();

    if (missing) {
      yield* h.apply(
        Message.ReceivedEvents({
          accountId: primary.accountId,
          request: h.model().calendar.rangeRequest,
          result: { events: [primary], versions: [] },
        })
      );
      yield* h.apply(
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request: h.model().upcoming.request,
          result: { events: [primary], versions: [] },
        })
      );
    }

    if (missing) {
      expect(
        visibleEvents(h.model())
          .filter((item) => item.selected)
          .flatMap((item) => item.copies.map((copy) => copy.source.eventId))
      ).toEqual([primary.eventId]);
    }

    expect(
      yield* h.apply(
        Option.getOrThrow(
          recoveryInteraction(h.model(), "type", "Team draft still editable")
        )
      )
    ).toBe(1);
    yield* h.receive();
    expect((yield* h.receive()).note).toBe("Team draft still editable");
    expect(h.calls).toHaveLength(0);

    const rendered = yield* renderToString(
      { init: () => ({ model: h.model() }), view },
      { isHydratable: false }
    );

    const dom = new DOMParser().parseFromString(rendered.html, "text/html");

    const buttons = [
      ...dom.querySelectorAll<HTMLButtonElement>(".event-rsvp button"),
    ];

    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.disabled)).toBe(missing);

    if (missing) {
      const dispatches = yield* h.apply(
        Message.EditingAction({
          action: EditorAction.cases.Rsvp.make({ response: "accepted" }),
        })
      );

      expect(dispatches).toBe(0);
      expect(h.calls).toHaveLength(0);
      expect(h.model().editing.rsvp.note).toBe("Team draft still editable");
    } else {
      yield* h.apply(
        Option.getOrThrow(recoveryInteraction(h.model(), "click", "Maybe"))
      );
      yield* h.receive();
      yield* h.receive();
      yield* h.receive();
      expect(h.calls).toEqual([
        {
          accountId: target.accountId,
          calendarId: target.calendarId,
          eventId: target.eventId,
          note: "Team draft still editable",
          response: "tentative",
          sendUpdates: "none",
        },
      ]);
    }
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
);

it.effect.each(
  [1280, 390].flatMap((width) =>
    [
      RecoveryBusy.make("rsvp"),
      RecoveryBusy.make("bulk-running"),
      RecoveryBusy.make("bulk-undoing"),
    ].flatMap((kind) =>
      [false, true].map((expired) => ({ expired, kind, width }))
    )
  )
)("root busy preparation history %j", ({ width, kind, expired }) =>
  Effect.gen(function* busyPreparation() {
    const h = yield* recoveryHost(recoveryModel(width));
    yield* h.apply(recoveryAdmission());
    const staged = yield* h.receive();
    const { prepared } = staged;
    expect(prepared).toBeDefined();

    if (prepared === undefined) {
      return yield* Effect.die("Preparation missing");
    }

    yield* h.apply(
      Option.getOrThrow(recoveryInteraction(h.model(), "type", "Busy draft"))
    );
    yield* h.receive();
    yield* h.receive();

    const queuedResponse = Option.getOrThrow(
      recoveryInteraction(h.model(), "click", "Maybe")
    );

    const focusRequests = h.effects.filter(
      (name) => name === "FocusRsvpNote"
    ).length;

    const selection = h.model().calendar.selected;
    const token = trayRsvpNoteToken(prepared.intent, prepared.id);

    const selector =
      width === 390 ? "#phone-shell-dialog #rsvp-note" : "#rsvp-note";

    expect(yield* h.apply(recoveryBusyMessage(h.model(), kind, true))).toBe(0);
    expect(responseIsBusy(h.model())).toBe(true);
    expect(h.model().editing.rsvp.prepared).toEqual(prepared);
    expect(h.model().editing.rsvp.note).toBe("Busy draft");

    const busyHtml = yield* renderToString(
      { init: () => ({ model: h.model() }), view },
      { isHydratable: false }
    );

    const busyDom = new DOMParser().parseFromString(busyHtml.html, "text/html");
    expect(
      busyDom.querySelector<HTMLTextAreaElement>(selector)?.dataset.trayRsvpNote
    ).toBe(token);
    expect(busyHtml.html).toContain("Add a note for Maybe");
    expect(yield* h.apply(recoveryAdmission())).toBe(0);
    expect(yield* h.apply(queuedResponse)).toBe(0);
    expect(h.calls).toHaveLength(0);

    if (expired) {
      expect(yield* h.apply(Message.Ticked({ now: recoveryEnd }))).toBe(1);
      const retired = yield* h.receive();
      expect(retired.prepared).toBeUndefined();
      expect(retired.draftTarget?._tag).toBe("DetailsDraft");
      expect(retired.note).toBe("Busy draft");
      expect(yield* h.apply(recoveryBusyMessage(h.model(), kind, true))).toBe(
        0
      );
      expect(responseIsBusy(h.model())).toBe(true);
      expect(h.model().editing.rsvp.prepared).toBeUndefined();
    } else {
      expect(yield* h.apply(Message.Ticked({ now: recoveryEnd - 1 }))).toBe(0);
      expect(h.model().editing.rsvp.prepared).toEqual(prepared);
    }

    expect(yield* h.apply(recoveryBusyMessage(h.model(), kind, false))).toBe(0);
    expect(responseIsBusy(h.model())).toBe(false);
    expect(h.model().editing.rsvp.prepared).toEqual(
      expired ? undefined : prepared
    );
    expect(h.model().editing.rsvp.note).toBe("Busy draft");
    expect(h.model().calendar.selected).toEqual(selection);
    expect(h.effects.filter((name) => name === "FocusRsvpNote")).toHaveLength(
      focusRequests
    );
    expect(h.calls).toHaveLength(0);
    expect(rsvpNoteTarget(h.model(), recoveryIntent) === undefined).toBe(
      expired
    );

    const idleHtml = yield* renderToString(
      { init: () => ({ model: h.model() }), view },
      { isHydratable: false }
    );

    const idleDom = new DOMParser().parseFromString(idleHtml.html, "text/html");
    expect(
      idleDom.querySelector<HTMLTextAreaElement>(selector)?.dataset
        .trayRsvpNote ?? null
    ).toBe(expired ? null : token);
    expect(idleHtml.html.includes("Add a note for Maybe")).toBe(!expired);

    return yield* Effect.void;
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
);

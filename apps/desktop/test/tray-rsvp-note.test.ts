import {
  TrayRsvpNote,
  DesktopAction,
  NativeNotificationAgenda,
  desktopWire,
} from "@calendar/core/desktop-bridge";
import type { AgendaEventValue } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import { TestClock } from "effect/testing";

import type { NativeIntentValue, NativeView } from "../src/native-host.js";
import { trayResponseMenu } from "../src/tray-response.js";
import { prepareTrayRsvpNote } from "../src/tray-rsvp-note.js";
import { trayEvent, trayView, trayNow } from "./tray-current-fixture.js";

const owner = NativeNotificationAgenda.make({
  deliveries: [],
  events: [],
  lease: "lease",
  personId: "person",
  revision: 1,
  version: 1,
});

const event = trayEvent("series_20261021T090000Z");

const intent = TrayRsvpNote.make({
  key: event.key,
  lease: "lease",
  personId: "person",
  response: "accepted",
  start: event.start,
});

const responses: readonly (typeof TrayRsvpNote.Type)["response"][] = [
  "accepted",
  "declined",
  "tentative",
];

const view: NativeView = {
  ...trayView([event]),
  agenda: { events: [event], notificationAgenda: owner },
};

it.effect(
  "Shift menu callbacks produce one scoped preparation action and preserve plain accelerators",
  () =>
    Effect.sync(() => {
      const actions: NativeIntentValue[] = [];

      const [menu] = trayResponseMenu(
        event,
        (action) => {
          actions.push(action);
        },
        owner
      );

      const rows = menu?.submenu ?? [];
      expect(
        rows
          .filter((row) => row.id?.startsWith("tray-response-") === true)
          .map((row) => [row.id, row.accelerator])
      ).toEqual([
        ["tray-response-yes", "Y"],
        ["tray-response-no", "N"],
        ["tray-response-maybe", "M"],
      ]);

      const notes = rows.filter(
        (row) => row.id?.startsWith("tray-note-") === true
      );

      expect(
        notes.map((row) => [row.id, row.accelerator, row.checked])
      ).toEqual([
        ["tray-note-yes", "Shift+Y", undefined],
        ["tray-note-no", "Shift+N", undefined],
        ["tray-note-maybe", "Shift+M", undefined],
      ]);

      for (const row of notes) {
        row.click?.();
      }

      expect(
        actions.map((action) =>
          Schema.decodeSync(desktopWire.action)(JSON.stringify(action))
        )
      ).toEqual(
        responses.map((response) =>
          DesktopAction.cases.PrepareRsvpNote.make({ ...intent, response })
        )
      );
    })
);

it.effect("missing scope and disabled RSVP do not emit note actions", () =>
  Effect.sync(() => {
    const cases: readonly {
      candidate: AgendaEventValue;
      scope?: typeof owner;
    }[] = [
      { candidate: event },
      {
        candidate: {
          ...event,
          rsvp: { enabled: false, response: "needsAction" },
        },
        scope: owner,
      },
    ];

    for (const { candidate, scope } of cases) {
      const actions: NativeIntentValue[] = [];

      const [menu] = trayResponseMenu(
        candidate,
        (action) => {
          actions.push(action);
        },
        scope
      );

      for (const row of menu?.submenu?.filter(
        (item) => item.id?.startsWith("tray-note-") === true
      ) ?? []) {
        expect(row.enabled).toBe(false);
        row.click?.();
      }

      expect(actions).toEqual([]);
    }
  })
);

it.effect(
  "accepted main handoff focuses the existing window before delivering the single preparation",
  () =>
    Effect.gen(function* acceptedHandoff() {
      yield* TestClock.setTime(trayNow);
      const effects: string[] = [];
      yield* prepareTrayRsvpNote(intent, view, {
        focus: Effect.sync(() => {
          effects.push("focus");
        }),
        prepare: (value) =>
          Effect.sync(() => {
            expect(value).toEqual(intent);
            effects.push("prepare");
          }),
        trusted: Effect.succeed(true),
      });
      expect(effects).toEqual(["focus", "prepare"]);
    })
);

it.effect.each([
  "ended",
  "not-current",
  "person",
  "lease",
  "start",
  "disabled",
  "untrusted",
  "account",
  "calendar",
])("main note handoff refuses %s without focus or dispatch", (kind) =>
  Effect.gen(function* refusedHandoff() {
    yield* TestClock.setTime(trayNow);
    let candidate: AgendaEventValue = event;
    let scope = owner;
    let trusted = true;
    let extras: readonly AgendaEventValue[] = [];

    switch (kind) {
      case "ended": {
        candidate = { ...event, end: trayNow };
        break;
      }

      case "not-current": {
        extras = [trayEvent("earlier", event.start - 1000)];
        break;
      }

      case "person": {
        scope = { ...owner, personId: "other" };
        break;
      }

      case "lease": {
        scope = { ...owner, lease: "other" };
        break;
      }

      case "start": {
        candidate = { ...event, start: event.start + 1 };
        break;
      }

      case "disabled": {
        candidate = {
          ...event,
          rsvp: { enabled: false, response: "needsAction" },
        };
        break;
      }

      case "untrusted": {
        trusted = false;
        break;
      }

      case "account": {
        candidate = { ...event, key: { ...event.key, accountId: "other" } };
        break;
      }

      case "calendar": {
        candidate = { ...event, key: { ...event.key, calendarId: "other" } };
        break;
      }

      default: {
        throw new Error("Unrecognized refusal history");
      }
    }

    const effects: string[] = [];

    const failure = yield* prepareTrayRsvpNote(
      intent,
      {
        ...view,
        agenda: { events: [...extras, candidate], notificationAgenda: scope },
      },
      {
        focus: Effect.sync(() => {
          effects.push("focus");
        }),
        prepare: () =>
          Effect.sync(() => {
            effects.push("prepare");
          }),
        trusted: Effect.succeed(trusted),
      }
    ).pipe(Effect.result);

    expect(Result.isFailure(failure)).toBe(true);

    if (Result.isFailure(failure)) {
      expect(failure.failure.message).toContain("meeting changed");
    }

    expect(effects).toEqual([]);
  })
);

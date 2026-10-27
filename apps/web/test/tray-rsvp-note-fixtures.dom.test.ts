import type { CalendarEventValue } from "@calendar/calendar/contracts";
import {
  DesktopAction,
  TrayRsvpNote,
  defaultDesktopPreferences,
} from "@calendar/core/desktop-bridge";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { DateTime, Effect, FileSystem, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import { DesktopNotice } from "../src/client/desktop/model.js";
import { EditingNotice } from "../src/client/editing/runtime.js";
import { view } from "../src/features/app.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";
import { trayNoteAppearanceProof } from "./tray-note-appearance-proof.js";
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

const start = DateTime.toEpochMillis(
  DateTime.makeUnsafe("2026-10-21T09:00:00Z")
);

const responses: readonly {
  response: (typeof TrayRsvpNote.Type)["response"];
  name: string;
}[] = [
  { name: "yes", response: "accepted" },
  { name: "no", response: "declined" },
  { name: "maybe", response: "tentative" },
];

const themes: readonly ("light" | "dark")[] = ["light", "dark"];

const fixture = (
  width: number,
  theme: "light" | "dark",
  response: (typeof TrayRsvpNote.Type)["response"]
) => {
  const base = upcomingFixture();

  const upcoming = update(
    base,
    Message.ReceivedUpcoming({
      personId: upcomingPerson,
      request: base.upcoming.request,
      result: { events: [event], versions: [] },
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
      result: { events: [event], versions: [] },
    })
  ).model;

  const measured = update(
    {
      ...rows,
      calendar: { ...rows.calendar, viewport: 700, viewportWidth: width },
      settings: { ...rows.settings, theme },
    },
    Message.MeasuredShellViewport({ width })
  ).model;

  const intent = TrayRsvpNote.make({
    key: {
      accountId: event.accountId,
      calendarId: event.calendarId,
      eventId: event.eventId,
    },
    lease: "lease",
    personId: upcomingPerson,
    response,
    start,
  });

  const requested = update(
    measured,
    Message.ReceivedDesktop({
      notice: DesktopNotice.cases.Action.make({
        action: DesktopAction.cases.PrepareRsvpNote.make(intent),
      }),
    })
  ).model;

  return update(
    requested,
    Message.ReceivedEditing({
      notice: EditingNotice.cases.Rsvp.make({
        view: {
          ...requested.editing.rsvp,
          focused: Option.some(event),
          note: "Ready to discuss the timing.",
          prepared: { id: 1, intent },
        },
      }),
      personId: upcomingPerson,
    })
  ).model;
};

const attribute = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

it.effect(
  "exports six actual-root staged response fixtures with desktop and 390px phone panes",
  () =>
    Effect.gen(function* exportNotes() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");
      const pointer = yield* fs.readFileString("src/client/coarse-pointer.css");

      for (const { response, name } of responses) {
        for (const theme of themes) {
          const frames: string[] = [];

          for (const width of [1280, 390]) {
            const model = fixture(width, theme, response);

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const dom = new DOMParser().parseFromString(
              rendered.html,
              "text/html"
            );

            const selector =
              width === 390
                ? "#phone-shell-dialog textarea[data-tray-rsvp-note]"
                : "textarea[data-tray-rsvp-note]";

            expect(dom.querySelector(selector)).not.toBeNull();
            expect(
              dom.querySelector<HTMLTextAreaElement>(selector)?.value
            ).toBe("Ready to discuss the timing.");

            const label = {
              accepted: "Yes",
              declined: "No",
              tentative: "Maybe",
            }[response];

            const script = `const dialog=document.querySelector('#phone-shell-dialog');if(dialog&&!dialog.open){dialog.showModal();}const selector=${JSON.stringify(selector)};document.querySelector(selector)?.focus();document.documentElement.dataset.fixtureReady='tray-rsvp-note';${trayNoteAppearanceProof(label)}`;
            const content = `<!doctype html><html lang="en" data-fixture-pane="${width === 390 ? "phone" : "desktop"}" data-geometry="browser-owned"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>${pointer}</style></head><body>${rendered.html}<script>${script}</script></body></html>`;
            frames.push(
              `<section><h2>${width}px ${width === 390 ? "phone details sheet" : "desktop details"}</h2><iframe title="${name} ${theme} ${width}" width="${width}" height="900" srcdoc="${attribute(content)}"></iframe></section>`
            );
          }

          const html = `<!doctype html><html lang="en" data-fixture-kind="tray-rsvp-note"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>P57 ${name} ${theme}</title></head><body><h1>${name} with note · ${theme}</h1><p>Actual app server render. Browser layout and modal focus are capture candidates, not live RSVP interaction proof. Tracked update and writer tests cover behavior.</p>${frames.join("")}</body></html>`;
          const parsed = new DOMParser().parseFromString(html, "text/html");
          expect(
            [...parsed.querySelectorAll("iframe")].map((frame) =>
              frame.getAttribute("width")
            )
          ).toEqual(["1280", "390"]);
          yield* publishFixtureArtifact(
            `../../.git/tray-rsvp-note-${name}-${theme}.html`,
            html
          );
        }
      }
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
);

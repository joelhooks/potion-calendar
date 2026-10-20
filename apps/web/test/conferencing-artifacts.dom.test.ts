import type { CalendarValue } from "@calendar/calendar/contracts";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { DateTime, Effect, FileSystem, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";

import type { AppModel } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { RemoteConferencingDefault } from "../src/client/conferencing/model.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import type { EditorViewValue } from "../src/client/editing/editor-model.js";
import { view } from "../src/features/app.js";
import { AccountSettingsRoute } from "../src/layout/route.js";
import {
  editorCalendars,
  editorOriginal,
  editorViewFields,
} from "./editor-fixture.js";
import { fixtureModel } from "./fixture.js";

const supported = editorCalendars.map((calendar) => ({
  ...calendar,
  allowedConferenceSolutionTypes: ["hangoutsMeet"],
}));

const ready = {
  ...editorOriginal,
  conferenceUrl: "https://meet.google.com/abc-defg-hij",
  conferencingStatus: "ready",
} as const;

const fields = { ...editorViewFields, original: Option.some(ready) };

const empty = {
  ...editorViewFields,
  kind: "create",
  original: Option.none(),
} as const;

const scenes: readonly {
  readonly name: string;
  readonly model: EditorViewValue;
  readonly calendars: readonly CalendarValue[];
}[] = [
  {
    calendars: supported,
    model: EditorView.cases.Editing.make(empty),
    name: "empty",
  },
  {
    calendars: supported,
    model: EditorView.cases.Editing.make({
      ...empty,
      draft: {
        ...empty.draft,
        conferencing: {
          participantSeen: true,
          request: { kind: "googleMeet" },
        },
      },
    }),
    name: "requested",
  },
  {
    calendars: supported,
    model: EditorView.cases.Editing.make({
      ...fields,
      draft: {
        ...fields.draft,
        conferencing: { participantSeen: true, request: { kind: "none" } },
      },
    }),
    name: "removed",
  },
  {
    calendars: supported,
    model: EditorView.cases.Editing.make(fields),
    name: "ready",
  },
  ...(["pending", "failed", "unconfirmed"] as const).map((status) => ({
    calendars: supported,
    model: EditorView.cases.Editing.make({
      ...fields,
      original: Option.some({
        ...editorOriginal,
        conference: { kind: "unrepresentable" },
        conferencingStatus: status,
      }),
    }),
    name: status,
  })),
  {
    calendars: editorCalendars.map((calendar) => ({
      ...calendar,
      allowedConferenceSolutionTypes: [],
    })),
    model: EditorView.cases.Editing.make(empty),
    name: "unsupported",
  },
  {
    calendars: supported.map((calendar) => ({
      ...calendar,
      accessRole: "reader",
    })),
    model: EditorView.cases.Editing.make({
      ...fields,
      permissions: {
        calendarWritable: false,
        editGuests: false,
        editMeeting: false,
        inviteGuests: false,
      },
    }),
    name: "readonly",
  },
  {
    calendars: supported,
    model: EditorView.cases.ConfirmConferencing.make(fields),
    name: "confirmation",
  },
];

const fixtureHtml = (
  body: string,
  css: string,
  title: string,
  width: number
) => {
  const script = `
    const dialogs = [...document.querySelectorAll('dialog[data-editing-dialog]')];
    for (const dialog of dialogs) {
      dialog.showModal();
      document.getElementById(dialog.dataset.initialFocus ?? '')?.focus();
    }
    const editor = dialogs.at(-1);
    const conferencing = editor?.querySelector('[aria-label="Conferencing"]');
    conferencing?.scrollIntoView({ block: 'nearest' });
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { id: element.id, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, horizontalOverflow: element.scrollWidth > element.clientWidth + 1 };
    };
    const controls = [...document.querySelectorAll('select[id^="conferencing-default-"]')];
    if (conferencing) controls.push(...conferencing.querySelectorAll('button,a'));
    const confirm = editor?.querySelector('button[id$="-confirm"]');
    if (confirm) controls.push(confirm);
    const bounds = editor ? box(editor) : undefined;
    const controlBounds = controls.map(box);
    const pageOverflow = document.documentElement.scrollWidth > innerWidth + 1;
    const editorClipped = bounds !== undefined && (bounds.left < -1 || bounds.right > innerWidth + 1 || bounds.top < -1 || bounds.bottom > innerHeight + 1 || bounds.horizontalOverflow);
    const controlClipping = controlBounds.filter((value) => value.left < -1 || value.right > innerWidth + 1 || value.top < -1 || value.bottom > innerHeight + 1 || value.horizontalOverflow || (bounds !== undefined && (value.left < bounds.left - 1 || value.right > bounds.right + 1)));
    const proof = { pageOverflow, editorClipped, editorBounds: bounds, controlBounds, controlClipping, viewport: { width: innerWidth, height: innerHeight } };
    document.documentElement.dataset.conferencingGeometryProof = JSON.stringify(proof);
    document.documentElement.dataset.conferencingLayoutProof = !pageOverflow && !editorClipped && controlClipping.length === 0 && controls.length > 0 ? 'pass' : 'fail';
    document.documentElement.dataset.fixtureReady = 'conferencing';
  `;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x900"><title>${title}</title><style>${css}</style></head><body>${body}<script>${script}</script></body></html>`;
};

it.effect(
  "exports actual editor conferencing controls in every state and the real default row in both themes and viewport sizes",
  () =>
    Effect.gen(function* conferencingArtifacts() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      for (const width of [1440, 900]) {
        for (const theme of ["light", "dark"] as const) {
          for (const scene of scenes) {
            const fixture = fixtureModel();

            const model: AppModel = {
              ...fixture,
              calendar: {
                ...fixture.calendar,
                calendars: scene.calendars,
                viewportWidth: width - (width <= 1000 ? 445 : 520),
              },
              editing: { ...fixture.editing, view: scene.model },
              settings: { ...fixture.settings, theme },
              upcoming: {
                ...fixture.upcoming,
                data: RemoteEvents.Success({
                  data: {
                    events: [
                      {
                        ...editorOriginal,
                        conferenceUrl: "https://meet.google.com/abc-defg-hij",
                        end: {
                          dateTime: DateTime.formatIso(
                            DateTime.makeUnsafe(
                              fixture.calendar.now + 45 * 60_000
                            )
                          ),
                        },
                        start: {
                          dateTime: DateTime.formatIso(
                            DateTime.makeUnsafe(
                              fixture.calendar.now + 15 * 60_000
                            )
                          ),
                        },
                        title: "Design review",
                      },
                    ],
                    versions: [],
                  },
                }),
              },
            };

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const document = new DOMParser().parseFromString(
              rendered.html,
              "text/html"
            );

            expect(
              document.querySelector('[aria-label="Conferencing"]')
            ).not.toBeNull();

            if (scene.name === "confirmation") {
              expect(
                document.querySelector("#replace-conferencing-dialog")
              ).not.toBeNull();
            }

            yield* fs.writeFileString(
              `../../.git/conferencing-editor-${scene.name}-${theme}-${width}-fixture.html`,
              fixtureHtml(
                rendered.html,
                css,
                `Conferencing editor: ${scene.name} ${theme}`,
                width
              )
            );
          }

          for (const value of ["unset", "none", "googleMeet"] as const) {
            const fixture = fixtureModel();

            const model: AppModel = {
              ...fixture,
              conferencing: {
                accounts: {
                  work: {
                    operation: "read",
                    remote: RemoteConferencingDefault.Success({
                      data: { accountId: "work", value },
                    }),
                    requestId: 1,
                  },
                },
                nextRequestId: 1,
              },
              route: AccountSettingsRoute.make({ accountId: "work" }),
              settings: { ...fixture.settings, theme },
            };

            const rendered = yield* renderToString(
              {
                init: () => ({ model }),
                view,
              },
              { isHydratable: false }
            );

            const document = new DOMParser().parseFromString(
              rendered.html,
              "text/html"
            );

            expect(document.querySelector("select")?.value).toBe(value);
            expect(document.querySelector("select")?.disabled).toBe(false);
            yield* fs.writeFileString(
              `../../.git/conferencing-default-${value}-${theme}-${width}-fixture.html`,
              fixtureHtml(
                rendered.html,
                css,
                `Conferencing account row: ${value} ${theme}`,
                width
              )
            );
          }
        }
      }
    }).pipe(Effect.provide(NodeServices.layer))
);

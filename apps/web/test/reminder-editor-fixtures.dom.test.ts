import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { EditorAction } from "../src/client/editing/editor-action.js";
import { view } from "../src/features/app.js";
import { editorCalendars } from "./editor-fixture.js";
import { keyboardFixture } from "./keyboard-fixture.js";
import {
  applyReminderAction,
  createReminderSession,
  reminderEditorView,
} from "./reminder-editor-fixture.js";

it.effect(
  "exports actual timed and all-day reminder pickers with accepted boundary chips and rejected typed input at both widths and themes",
  () =>
    Effect.gen(function* reminderPickerArtifacts() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");
      const base = keyboardFixture();

      for (const allDay of [false, true]) {
        let session = yield* createReminderSession(allDay);

        if (session.draft.reminders.useDefault) {
          session = yield* applyReminderAction(
            session,
            EditorAction.cases.ToggleDefaultReminders.make({})
          );
        }

        session = yield* applyReminderAction(
          {
            ...session,
            draft: { ...session.draft, reminderInput: "672 hours" },
          },
          EditorAction.cases.AddReminder.make({})
        );

        const typed = {
          ...session,
          draft: { ...session.draft, reminderInput: "673 hours" },
        };

        const failure = yield* applyReminderAction(
          typed,
          EditorAction.cases.AddReminder.make({})
        ).pipe(Effect.flip);

        for (const width of [1440, 900]) {
          const panelSpace = width <= 1000 ? 445 : 520;

          for (const theme of ["light", "dark"] as const) {
            const model = {
              ...base,
              calendar: {
                ...base.calendar,
                calendars: editorCalendars,
                viewportWidth: width - panelSpace - 60,
              },
              editing: {
                ...base.editing,
                view: reminderEditorView(typed, Option.some(failure.message)),
              },
              settings: { ...base.settings, theme },
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
              document.querySelector("[data-reminder-minutes='40320']")
            ).not.toBeNull();
            expect(
              document.querySelector("#event-editor-dialog [role=alert]")
                ?.textContent
            ).toContain("1 minute to 28 days");

            const mode = allDay ? "all-day" : "timed";

            const choices = allDay
              ? [0, 1440, 2880, 4320, 10_080]
              : [0, 5, 10, 30, 60];

            const proof = `const expected=${JSON.stringify(choices)};const dialog=document.querySelector('#event-editor-dialog');if(!dialog)throw Error('Missing editor');dialog.showModal();const scroll=dialog.querySelector('.editor-scroll');if(!scroll)throw Error('Missing editor scroll');scroll.scrollTop=scroll.scrollHeight;const input=dialog.querySelector('#event-reminderInput');input?.focus({preventScroll:true});const picker=dialog.querySelector('[aria-label="Reminders"]');const options=[...picker.querySelectorAll('select option')].filter(option=>option.value!=='').map(option=>Number(option.value));if(JSON.stringify(options)!==JSON.stringify(expected))throw Error('Incorrect suggestions');if(input?.value!=='673 hours'||!dialog.querySelector('[role="alert"]')?.textContent.includes('1 minute to 28 days')||!picker.querySelector('[data-reminder-minutes="40320"]'))throw Error('Missing typed validation');const frame=dialog.getBoundingClientRect();if(frame.left<0||frame.right>innerWidth||document.documentElement.scrollWidth>innerWidth||scroll.scrollWidth>scroll.clientWidth+1)throw Error('Picker overflow');const bounds=scroll.getBoundingClientRect();for(const control of picker.querySelectorAll('input,select,button')){const box=control.getBoundingClientRect();if(box.left<bounds.left||box.right>bounds.right||box.top<bounds.top||box.bottom>bounds.bottom)throw Error('Picker control clipped');}document.documentElement.dataset.reminderPickerProof='pass';`;

            yield* fs.writeFileString(
              `../../.git/reminder-editor-${mode}-${theme}-${width}-fixture.html`,
              `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x900"><title>${mode} reminder picker ${theme} ${width}</title><style>${css}</style></head><body>${rendered.html}<script>${proof}</script></body></html>`
            );
          }
        }
      }
    }).pipe(Effect.provide(NodeServices.layer))
);

import { googleCalendarCapabilities } from "@calendar/calendar/contracts";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { EditorView } from "../src/client/editing/editor-model.js";
import { view } from "../src/features/app.js";
import {
  editorDraft,
  editorViewFields,
  emailFixture,
  renderEditorFixture,
  renderUndoFixture,
  repeatFixture,
  scopeFixture,
} from "./editor-fixture.js";
import { fixtureSelection } from "./fixture.js";

const documentFor = (html: string): Document =>
  new DOMParser().parseFromString(html, "text/html");

it.effect(
  "the actual editor renders plain description text and all seventeen colour slots without inventing Google mappings",
  () =>
    Effect.gen(function* editorFieldsDom() {
      const model = EditorView.cases.Editing.make({
        ...editorViewFields,
        draft: {
          ...editorDraft,
          description: "<script>not executable</script>",
        },
      });

      const document = documentFor((yield* renderEditorFixture(model)).html);
      expect(
        document.querySelector<HTMLInputElement>("#event-title")?.value
      ).toBe("Product review");
      expect(
        document.querySelector<HTMLTextAreaElement>("#event-description")?.value
      ).toBe("<script>not executable</script>");
      expect(
        document.querySelectorAll("#event-editor-dialog script")
      ).toHaveLength(0);
      expect(document.querySelectorAll(".editor-colour")).toHaveLength(17);

      const unsupported = [
        ...document.querySelectorAll<HTMLButtonElement>(
          ".editor-colour:disabled"
        ),
      ];

      expect(unsupported).toHaveLength(6);
      expect(
        unsupported.every(
          (button) =>
            button
              .getAttribute("aria-label")
              ?.includes("not available in Google Calendar") === true
        )
      ).toBe(true);
      expect(document.querySelectorAll("#event-calendar option")).toHaveLength(
        2
      );
      expect(
        document.querySelector<HTMLSelectElement>("#event-calendar")?.disabled
      ).toBe(true);
      expect(
        document.querySelector("[role=radiogroup] [aria-checked=true]")
          ?.textContent
      ).toBe("Use calendar color");
    })
);

it.effect(
  "provider-owned reminder limits disable further input and selected suggestions cannot duplicate a reminder",
  () =>
    Effect.gen(function* reminderLimitsDom() {
      const limit = googleCalendarCapabilities.maxRemindersCount;

      const model = EditorView.cases.Editing.make({
        ...editorViewFields,
        draft: {
          ...editorDraft,
          reminders: {
            overrides: Array.from({ length: limit }, (_, index) => ({
              method: "popup",
              minutes: (index + 1) * 10,
            })),
            useDefault: false,
          },
        },
      });

      const document = documentFor((yield* renderEditorFixture(model)).html);
      expect(
        document.querySelector<HTMLInputElement>("#event-reminderInput")
          ?.disabled
      ).toBe(true);
      expect(
        document.querySelector<HTMLSelectElement>(
          "[aria-label='Reminder suggestions']"
        )?.disabled
      ).toBe(true);
      expect(
        document.querySelector<HTMLOptionElement>(
          "[aria-label='Reminder suggestions'] option[value='10']"
        )?.disabled
      ).toBe(true);
      expect(document.body.textContent).toContain(
        `Reminders limited to ${limit}`
      );
    })
);

it.effect(
  "scope selection preserves the chosen scope and email submission defaults to Don't send",
  () =>
    Effect.gen(function* scopeAndEmailDom() {
      const scope = EditorView.cases.Scope.make({
        ...scopeFixture,
        selected: Option.some("all"),
      });

      const document = documentFor((yield* renderEditorFixture(scope)).html);

      const radios = [
        ...document.querySelectorAll<HTMLInputElement>(
          "#repeat-scope-dialog input[type=radio]"
        ),
      ];

      expect(radios.map((radio) => radio.value)).toEqual([
        "single",
        "allFollowing",
        "all",
      ]);
      expect(radios.find((radio) => radio.checked)?.value).toBe("all");

      const email = documentFor(
        (yield* renderEditorFixture(emailFixture)).html
      );

      expect(
        email.querySelector("#email-update-dialog button[type=submit]")
          ?.textContent
      ).toBe("Don't send");
      expect(
        email.querySelector<HTMLButtonElement>("#send-email-update")?.type
      ).toBe("button");
      expect(
        email.querySelector<HTMLElement>("#email-update-dialog")?.dataset
          .initialFocus
      ).toBe("email-update-dialog-confirm");
    })
);

it.effect(
  "custom repeat exposes the interval, selected weekdays and occurrence limit without expanding the series",
  () =>
    Effect.gen(function* customRepeatDom() {
      const document = documentFor(
        (yield* renderEditorFixture(repeatFixture)).html
      );

      expect(
        document.querySelector<HTMLInputElement>("#repeat-interval")?.value
      ).toBe("2");
      expect(
        document.querySelector<HTMLSelectElement>("#repeat-frequency")?.value
      ).toBe("WEEKLY");
      expect(
        document.querySelector<HTMLInputElement>("#repeat-count")?.value
      ).toBe("10");
      expect(
        document.querySelectorAll(
          "#custom-repeat-dialog input[type=checkbox]:checked"
        )
      ).toHaveLength(2);
      expect(document.body.textContent).toContain(
        "These settings replace the current repeat rule."
      );
    })
);

it.effect(
  "exports the actual Foldkit editor and dialog components for fenced captures",
  () =>
    Effect.gen(function* editorArtifacts() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      const base = yield* renderToString(
        { init: () => ({ model: fixtureSelection() }), view },
        { isHydratable: false }
      );

      const scenes = [
        {
          model: EditorView.cases.Editing.make(editorViewFields),
          name: "editor",
        },
        { model: scopeFixture, name: "scope" },
        { model: emailFixture, name: "email" },
        { model: repeatFixture, name: "repeat" },
      ];

      for (const scene of scenes) {
        const rendered = yield* renderEditorFixture(scene.model);
        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Calendar ${scene.name}</title><style>${css}</style></head><body>${base.html}${rendered.html}<script>const viewport=document.querySelector('#time-viewport');if(viewport){viewport.scrollTop=Math.max(0,504-viewport.clientHeight/3)}document.querySelectorAll('dialog[data-editing-dialog]').forEach(dialog=>{dialog.showModal();document.getElementById(dialog.dataset.initialFocus??'')?.focus()});document.documentElement.dataset.fixtureReady='editing';</script></body></html>`;
        yield* fs.writeFileString(
          `../../.git/editing-${scene.name}-fixture.html`,
          html
        );
        expect(rendered.html).toContain("editor-dialog");
      }

      const undo = yield* renderUndoFixture();
      const undoDocument = documentFor(undo.html);
      expect(
        undoDocument.querySelector(".undo-toast[role=status]")?.textContent
      ).toContain("Product review removed");
      expect(
        undoDocument.querySelector(".undo-toast button")?.textContent
      ).toBe("Undo");
      const undoHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Calendar Undo</title><style>${css}</style></head><body>${undo.html}<script>document.documentElement.dataset.fixtureReady='editing';</script></body></html>`;
      yield* fs.writeFileString(
        "../../.git/editing-undo-fixture.html",
        undoHtml
      );
    }).pipe(Effect.provide(NodeServices.layer))
);

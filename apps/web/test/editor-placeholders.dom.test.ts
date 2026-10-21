import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { EditorView } from "../src/client/editing/editor-model.js";
import { renderEditorFixture } from "./editor-fixture.js";
import {
  placeholderFields,
  placeholderModel,
  renderPlaceholderRoot,
} from "./editor-placeholders-fixture.js";

it.effect.each(["create", "edit"] as const)(
  "shows the exact ordinary placeholders in an empty %s editor without inventing a required-title context",
  (kind) =>
    Effect.gen(function* emptyPlaceholders() {
      const model = placeholderModel(kind);
      expect(EditorView.guards.Editing(model.editing.view)).toBe(true);
      const rendered = yield* renderPlaceholderRoot(model);

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      for (const [id, text] of placeholderFields) {
        const field = document.querySelector(`#${id}`);
        expect(field, id).not.toBeNull();
        expect(field?.getAttribute("placeholder"), id).toBe(text);
        expect(
          document.querySelector(`label[for="${id}"]`)?.textContent
        ).toContain(text);
        expect(field?.hasAttribute("disabled"), id).toBe(false);
      }

      expect(
        document.querySelector("#event-title")?.hasAttribute("required")
      ).toBe(false);
      expect(
        document.querySelector("#event-startDate")?.hasAttribute("required")
      ).toBe(true);
      expect(
        document.querySelector("#event-startDate")?.hasAttribute("placeholder")
      ).toBe(false);
      expect(
        document.querySelector("#event-startTime")?.hasAttribute("placeholder")
      ).toBe(false);
      expect(
        document.querySelector('[placeholder="Title (required)"]')
      ).toBeNull();
    })
);

const visibleText = Schema.Array(
  Schema.Int.check(Schema.isBetween({ maximum: 126, minimum: 32 }))
).check(Schema.isMaxLength(30));

it.effect.prop(
  "placeholder hints preserve generated visible-text values and do not become event data",
  { description: visibleText, location: visibleText, title: visibleText },
  (characters) =>
    Effect.gen(function* preservedValues() {
      const values = {
        description: String.fromCodePoint(...characters.description),
        location: String.fromCodePoint(...characters.location),
        title: String.fromCodePoint(...characters.title),
      };

      const model = placeholderModel("edit", 1440, "light", values);
      const rendered = yield* renderEditorFixture(model.editing.view);

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      for (const [name, value] of Object.entries(values)) {
        const field = document.querySelector(`#event-${name}`);
        expect(
          field instanceof HTMLInputElement ||
            field instanceof HTMLTextAreaElement
        ).toBe(true);

        if (
          field instanceof HTMLInputElement ||
          field instanceof HTMLTextAreaElement
        ) {
          expect(field.value).toBe(value);
        }
      }

      for (const [id, text] of placeholderFields) {
        expect(
          document.querySelector(`#${id}`)?.getAttribute("placeholder")
        ).toBe(text);
      }
    }),
  { arbitrary: { runs: 100 } }
);

it.effect.each(["focusTime", "outOfOffice"] as const)(
  "preserves existing location/description omission on %s",
  (eventType) =>
    Effect.gen(function* statusFields() {
      const model = placeholderModel("create");

      const editor = yield* Schema.decodeUnknownEffect(
        EditorView.cases.Editing
      )(model.editing.view);

      const rendered = yield* renderPlaceholderRoot({
        ...model,
        editing: {
          ...model.editing,
          view: {
            ...editor,
            draft: { ...editor.draft, eventType },
          },
        },
      });

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      expect(
        document.querySelector("#event-title")?.getAttribute("placeholder")
      ).toBe("Title");
      expect(document.querySelector("#event-location")).toBeNull();
      expect(document.querySelector("#event-description")).toBeNull();
    })
);

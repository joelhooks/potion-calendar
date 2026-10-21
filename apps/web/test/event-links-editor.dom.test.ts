import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { observeKeyboard } from "../src/client/keyboard/input.js";
import { view } from "../src/features/app.js";
import { editorDraft, editorViewFields } from "./editor-fixture.js";
import { fixtureSelection } from "./fixture.js";

it.effect(
  "E K opens the real editor command focused on the read-only links section",
  () =>
    Effect.sync(() => {
      let model = fixtureSelection();

      for (const key of ["e", "k"]) {
        const event = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key,
        });

        const message = observeKeyboard(model, event, model.calendar.now);
        expect(Option.isSome(message)).toBe(true);

        if (Option.isSome(message)) {
          const next = update(model, message.value);
          ({ model } = next);

          if (key === "k") {
            expect(model.keyboard.focus).toBe("event-links");
            expect(
              next.commands?.some(
                (command) => command.name === "DispatchEditing"
              )
            ).toBe(true);
          }
        }
      }

      expect(Message.KeyboardAction({ id: "edit-links" })._tag).toBe(
        "KeyboardAction"
      );
    })
);

it.effect(
  "the editor omits out-of-office attachments, location, description, guests and conferencing without mutating the draft",
  () =>
    Effect.gen(function* omittedAttachmentControls() {
      const fixture = fixtureSelection();

      const draft = {
        ...editorDraft,
        attachments: [
          { title: "Hidden file", url: "https://example.test/file" },
        ],
        eventType: "outOfOffice" as const,
      };

      const model = {
        ...fixture,
        editing: {
          ...fixture.editing,
          view: EditorView.cases.Editing.make({ ...editorViewFields, draft }),
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

      const dialog = document.querySelector("#event-editor-dialog");
      expect(dialog).not.toBeNull();
      expect(
        dialog?.querySelector(
          "#event-links, .event-attachments, #event-location, #event-description, #event-participantEmail, [aria-label='Conferencing']"
        )
      ).toBeNull();
      expect(model.editing.view.draft.attachments).toEqual(draft.attachments);
    })
);

import { expect, it } from "@effect/vitest";
import { Effect, Ref } from "effect";

import { Message, update } from "../src/client/app.js";
import { createTypeLabels } from "../src/client/editing/create-type-choices.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import {
  EditorView,
  currentConversion,
} from "../src/client/editing/editor-model.js";
import { commandChoices } from "../src/client/keyboard/choices.js";
import { noProviderWrites } from "./command-type-fixture.js";
import {
  createTypeRuntimeFixture,
  nextTypeNotice,
  renderTypeRoot,
} from "./create-type-runtime-fixture.js";

it.effect(
  "an editable creation draft offers Change event type through the command catalog",
  () =>
    Effect.gen(function* draftTypeCatalog() {
      const f = yield* createTypeRuntimeFixture("event");

      const opened = update(
        yield* Ref.get(f.state),
        Message.KeyboardAction({ id: "commands" })
      ).model;

      expect(
        commandChoices(opened).find((choice) => choice.id === "event-type")
          ?.title
      ).toBe("Change event type");
      expect(noProviderWrites(yield* Ref.get(f.api.fake.requests))).toEqual([]);
    })
);

for (const source of ["event", "focus", "ooo"] as const) {
  for (const target of ["default", "focusTime", "outOfOffice"] as const) {
    if (
      { event: "default", focus: "focusTime", ooo: "outOfOffice" }[source] ===
      target
    ) {
      continue;
    }

    it.effect(
      `command converts ${source} to ${target} with exact local Undo and no provider writes`,
      () =>
        Effect.gen(function* commandConversionRecipient() {
          const f = yield* createTypeRuntimeFixture(source);
          const before = yield* Ref.get(f.state);
          expect(EditorView.guards.Editing(before.editing.view)).toBe(true);

          if (!EditorView.guards.Editing(before.editing.view)) {
            return;
          }

          const { draft } = before.editing.view;
          yield* f.dispatchMessage(Message.KeyboardAction({ id: "commands" }));
          yield* f.dispatchMessage(Message.KeyboardPick({ id: "event-type" }));
          expect((yield* Ref.get(f.state)).keyboard.screen).toBe("event-type");
          yield* f.dispatchMessage(
            Message.KeyboardPick({ id: `type-${target}` })
          );

          const converted = yield* nextTypeNotice(
            f.queue,
            (notice) =>
              EditorView.guards.Editing(notice.view) &&
              notice.view.draft.eventType === target &&
              currentConversion(notice.view) !== undefined
          );

          const receipt = currentConversion(converted.view);
          expect(receipt?.target).toBe(target);
          expect((yield* Ref.get(f.state)).keyboard.screen).toBe("closed");
          expect(converted.view).toMatchObject({
            draft: { ...draft, eventType: target },
          });
          expect(noProviderWrites(yield* Ref.get(f.api.fake.requests))).toEqual(
            []
          );
          expect(f.api.requests).toEqual([]);
          const rendered = yield* renderTypeRoot(yield* Ref.get(f.state));
          expect(rendered.html).toContain(
            `Converted to ${createTypeLabels[target]}`
          );
          expect(receipt).toBeDefined();

          if (receipt === undefined) {
            return;
          }

          yield* f.dispatch(
            EditorAction.cases.UndoConversion.make({ id: receipt.id })
          );

          const restored = yield* nextTypeNotice(
            f.queue,
            (notice) =>
              EditorView.guards.Editing(notice.view) &&
              notice.view.draft.eventType === draft.eventType &&
              currentConversion(notice.view) === undefined
          );

          expect(restored.view).toMatchObject({ draft });
          expect(noProviderWrites(yield* Ref.get(f.api.fake.requests))).toEqual(
            []
          );
          expect(f.api.requests).toEqual([]);
        })
    );
  }
}

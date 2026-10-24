import { expect, it } from "@effect/vitest";
import { Effect, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";
import { Scene } from "foldkit/test";

import type { AppMessage, AppModel } from "../src/client/app.js";
import {
  currentConversion,
  EditorView,
} from "../src/client/editing/editor-model.js";
import {
  createTypeRuntimeFixture,
  nextTypeNotice,
  renderTypeRoot,
} from "./create-type-runtime-fixture.js";
import {
  conversionEditorScene,
  conversionInputMessage,
} from "./type-conversion-ui-fixture.js";

it.effect.each(["description", "location", "participantEmail"] as const)(
  "a filled real %s control withholds OOO conversion and preserves every draft field",
  (field) =>
    Effect.gen(function* filledFieldRecipient() {
      const f = yield* createTypeRuntimeFixture("event");

      const value =
        field === "participantEmail"
          ? "guest@example.test"
          : "Unsent user work";

      yield* f.dispatchMessage(
        conversionInputMessage(
          yield* Ref.get(f.state),
          `#event-${field}`,
          value
        )
      );
      yield* nextTypeNotice(
        f.queue,
        (notice) =>
          EditorView.guards.Editing(notice.view) &&
          notice.view.draft[field] === value
      );
      yield* f.dispatchMessage(
        conversionInputMessage(yield* Ref.get(f.state), "#event-title", "OOO")
      );

      const before = yield* nextTypeNotice(
        f.queue,
        (notice) =>
          EditorView.guards.Editing(notice.view) &&
          notice.view.draft.title === "OOO"
      );

      const beforeView = yield* Schema.decodeUnknownEffect(
        EditorView.cases.Editing
      )(before.view);

      yield* TestClock.adjust(250);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      const state = yield* Ref.get(f.state);

      const after = yield* Schema.decodeUnknownEffect(EditorView.cases.Editing)(
        state.editing.view
      );

      expect(after.draft).toEqual(beforeView.draft);
      expect(currentConversion(after)).toBeUndefined();
      const rendered = yield* renderTypeRoot(state);
      expect(rendered.html).not.toContain("data-conversion-undo");
      expect(yield* Ref.get(f.api.fake.receipts)).toEqual([]);
    })
);

it.effect(
  "an unoffered calendar type stays unchanged after actual title input and produces no toast",
  () =>
    Effect.gen(function* unofferedRecipient() {
      const f = yield* createTypeRuntimeFixture("ineligible");
      expect(f.calendar.primary).toBe(false);
      const initial = yield* Ref.get(f.state);
      const rendered = yield* renderTypeRoot(initial);

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      expect(
        document
          .querySelector('#event-type option[value="focusTime"]')
          ?.hasAttribute("disabled")
      ).toBe(true);
      yield* f.dispatchMessage(
        conversionInputMessage(initial, "#event-title", "Focus")
      );
      yield* nextTypeNotice(
        f.queue,
        (notice) =>
          EditorView.guards.Editing(notice.view) &&
          notice.view.draft.title === "Focus"
      );
      yield* TestClock.adjust(250);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;

      const final = yield* Schema.decodeUnknownEffect(EditorView.cases.Editing)(
        (yield* Ref.get(f.state)).editing.view
      );

      expect(final.draft.eventType ?? "default").toBe("default");
      expect(currentConversion(final)).toBeUndefined();
      expect(yield* Ref.get(f.api.fake.receipts)).toEqual([]);
    })
);

it.effect.each(["manual", "title"] as const)(
  "the actual %s control invalidates the toast and its previously captured Undo cannot discard newer work",
  (kind) =>
    Effect.gen(function* invalidatedRecipient() {
      const f = yield* createTypeRuntimeFixture("event");
      yield* f.dispatchMessage(
        conversionInputMessage(yield* Ref.get(f.state), "#event-title", "Focus")
      );
      yield* nextTypeNotice(
        f.queue,
        (notice) =>
          EditorView.guards.Editing(notice.view) &&
          notice.view.draft.title === "Focus"
      );
      yield* TestClock.adjust(250);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      const converted = yield* Ref.get(f.state);
      const conversion = currentConversion(converted.editing.view);
      expect(conversion).toBeDefined();

      if (conversion === undefined) {
        return;
      }

      yield* nextTypeNotice(
        f.queue,
        (row) => currentConversion(row.view)?.id === conversion.id
      );
      const captured: AppMessage[] = [];
      Scene.scene(
        {
          update: (model: AppModel, message: AppMessage) => {
            captured.push(message);

            return { model };
          },
          view: conversionEditorScene,
        },
        Scene.given(converted),
        Scene.click(Scene.selector("[data-conversion-undo] button"))
      );
      expect(captured).toHaveLength(1);
      const [stale] = captured;

      if (stale === undefined) {
        return;
      }

      const field = kind === "manual" ? "eventType" : "title";
      const value = kind === "manual" ? "default" : "Newer work";
      yield* f.dispatchMessage(
        conversionInputMessage(
          converted,
          kind === "manual" ? "#event-type" : "#event-title",
          value
        )
      );
      yield* nextTypeNotice(
        f.queue,
        (notice) =>
          EditorView.guards.Editing(notice.view) &&
          notice.view.draft[field] === value
      );

      const changed = yield* Schema.decodeUnknownEffect(
        EditorView.cases.Editing
      )((yield* Ref.get(f.state)).editing.view);

      expect(currentConversion(changed)).toBeUndefined();
      yield* f.dispatchMessage(stale);
      yield* TestClock.adjust(1000);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;

      const after = yield* Schema.decodeUnknownEffect(EditorView.cases.Editing)(
        (yield* Ref.get(f.state)).editing.view
      );

      expect(after.draft).toEqual(changed.draft);
      expect(currentConversion(after)).toBeUndefined();
      const rendered = yield* renderTypeRoot(yield* Ref.get(f.state));
      expect(rendered.html).not.toContain("data-conversion-undo");
      expect(yield* Ref.get(f.api.fake.receipts)).toEqual([]);
    })
);

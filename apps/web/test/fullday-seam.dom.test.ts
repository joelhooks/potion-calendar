import { expect, it } from "@effect/vitest";
import { Effect, Predicate } from "effect";

import { EditorView } from "../src/client/editing/editor-model.js";
import { minuteToY } from "../src/layout/geometry.js";
import { isoFromDay } from "../src/layout/navigation.js";
import { fulldayModel, mountedFullday } from "./fullday-fixture.js";
import { fulldaySession } from "./fullday-runtime-fixture.js";

const at = (
  cell: HTMLElement,
  type: "pointerdown" | "pointerup",
  x: number,
  y: number,
  time: number,
  meta: boolean
) => {
  const event = new PointerEvent(type, {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX: x,
    clientY: y,
    ctrlKey: !meta,
    isPrimary: true,
    metaKey: meta,
    pointerId: 72,
    pointerType: "mouse",
  });

  Object.defineProperty(event, "timeStamp", { value: time });
  (type === "pointerdown" ? cell : window).dispatchEvent(event);
};

it.effect(
  "native hidden-weekday seam uses the completing hit date rather than the second-down column",
  () =>
    Effect.gen(function* completingSeam() {
      const h = yield* mountedFullday(fulldayModel("multi-day"), "MacIntel");

      const index = h.cells.findLastIndex(
        (cell, i) =>
          i > 0 &&
          Number(cell.dataset.day) - Number(h.cells[i - 1]?.dataset.day) > 1
      );

      expect(index).toBeGreaterThan(0);
      const left = yield* Effect.fromNullishOr(h.cells[index - 1]);
      const right = yield* Effect.fromNullishOr(h.cells[index]);
      const edge = left.getBoundingClientRect().right;
      const y = left.getBoundingClientRect().top + minuteToY(h.grid, 1439);

      for (const [type, x, time] of [
        ["pointerdown", edge - 2, 100],
        ["pointerup", edge - 2, 101],
        ["pointerdown", edge - 1, 300],
        ["pointerup", edge + 1, 301],
      ] as const) {
        at(left, type, x, y, time, true);
        yield* h.next(
          (message) =>
            Predicate.isTagged(message, "PreviewedGesture") &&
            message.phase === (type === "pointerdown" ? "armed" : "idle")
        );

        if (time === 101) {
          expect(h.commands).toHaveLength(0);
        }
      }

      yield* h.next((message) =>
        Predicate.isTagged(message, "CompletedGesture")
      );
      expect(h.commands).toHaveLength(1);
      const command = yield* Effect.fromNullishOr(h.commands[0]);
      const date = isoFromDay(Number(right.dataset.day));
      const session = yield* fulldaySession(h.get(), command, date);
      const editor = session.opened.editing.view;
      expect(EditorView.guards.Editing(editor) && editor.draft.allDay).toBe(
        true
      );
      expect(EditorView.guards.Editing(editor) && editor.draft.startDate).toBe(
        date
      );
      expect(EditorView.guards.Editing(editor) && editor.draft.endDate).toBe(
        date
      );
    }).pipe(Effect.scoped)
);

it.effect("native Mac Control is not the full-day Mod mapping", () =>
  Effect.gen(function* macControl() {
    const h = yield* mountedFullday(fulldayModel("timed"), "MacIntel");
    const cell = yield* Effect.fromNullishOr(h.cells.at(-1));
    const rect = cell.getBoundingClientRect();

    for (const [type, time] of [
      ["pointerdown", 100],
      ["pointerup", 101],
      ["pointerdown", 300],
      ["pointerup", 301],
    ] as const) {
      at(
        cell,
        type,
        rect.left + 50,
        rect.top + minuteToY(h.grid, 540),
        time,
        false
      );
      yield* h.next(
        (message) =>
          Predicate.isTagged(message, "PreviewedGesture") &&
          message.phase === (type === "pointerdown" ? "armed" : "idle")
      );
    }

    yield* h.next((message) => Predicate.isTagged(message, "CompletedGesture"));
    const command = yield* Effect.fromNullishOr(h.commands[0]);

    const session = yield* fulldaySession(
      h.get(),
      command,
      isoFromDay(Number(cell.dataset.day))
    );

    const editor = session.opened.editing.view;
    expect(EditorView.guards.Editing(editor)).toBe(true);
    expect(EditorView.guards.Editing(editor) && editor.draft.allDay).toBe(
      false
    );
  }).pipe(Effect.scoped)
);

it.effect("native Month seam chooses only the completing cell date", () =>
  Effect.gen(function* monthSeam() {
    const h = yield* mountedFullday(fulldayModel("month"), "MacIntel");
    const left = yield* Effect.fromNullishOr(h.cells[2]);
    const right = yield* Effect.fromNullishOr(h.cells[3]);
    expect(Number(right.dataset.day) - Number(left.dataset.day)).toBe(1);
    const rect = left.getBoundingClientRect();
    expect(right.getBoundingClientRect().left).toBe(rect.right);

    for (const [type, x, time] of [
      ["pointerdown", rect.right - 2, 100],
      ["pointerup", rect.right - 2, 101],
      ["pointerdown", rect.right - 1, 300],
      ["pointerup", rect.right + 1, 301],
    ] as const) {
      at(left, type, x, rect.top + 10, time, true);
      yield* h.next(
        (message) =>
          Predicate.isTagged(message, "PreviewedGesture") &&
          message.phase === (type === "pointerdown" ? "armed" : "idle")
      );

      if (time === 101) {
        expect(h.commands).toHaveLength(0);
      }
    }

    yield* h.next((message) => Predicate.isTagged(message, "CompletedGesture"));
    expect(h.commands).toHaveLength(1);
    const command = yield* Effect.fromNullishOr(h.commands[0]);
    const date = isoFromDay(Number(right.dataset.day));
    const session = yield* fulldaySession(h.get(), command, date);
    const editor = session.opened.editing.view;
    expect(EditorView.guards.Editing(editor) && editor.draft.allDay).toBe(true);
    expect(EditorView.guards.Editing(editor) && editor.draft.startDate).toBe(
      date
    );
    expect(EditorView.guards.Editing(editor) && editor.draft.endDate).toBe(
      date
    );
  }).pipe(Effect.scoped)
);

for (const mod of [false, true]) {
  it.effect(`native completion samples pointer-up Mod=${mod}`, () =>
    Effect.gen(function* nativeUpModifier() {
      const h = yield* mountedFullday(fulldayModel("timed"), "MacIntel");
      const cell = yield* Effect.fromNullishOr(h.cells.at(-1));
      yield* h.click(cell, 100, 540);
      yield* h.pointer("pointerdown", cell, 300, 540, { mod: !mod });
      yield* h.pointer("pointerup", cell, 301, 540, { mod });
      yield* h.next((message) =>
        Predicate.isTagged(message, "CompletedGesture")
      );
      expect(h.commands).toHaveLength(1);
      const command = yield* Effect.fromNullishOr(h.commands[0]);

      const session = yield* fulldaySession(
        h.get(),
        command,
        isoFromDay(Number(cell.dataset.day))
      );

      const editor = session.opened.editing.view;
      expect(EditorView.guards.Editing(editor)).toBe(true);
      expect(EditorView.guards.Editing(editor) && editor.draft.allDay).toBe(
        mod
      );
    }).pipe(Effect.scoped)
  );
}

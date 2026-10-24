import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { send, waitFor } from "@xstate/effect";
import { Arbitrary, Effect, Option, Schema } from "effect";
import { TestClock } from "effect/testing";

import { EditorAction } from "../src/client/editing/editor-action.js";
import { projectEditor } from "../src/client/editing/editor-machine.js";
import { currentConversion } from "../src/client/editing/editor-model.js";
import { EditorRequest } from "../src/client/editing/editor-session-model.js";
import { editorOriginal } from "./editor-fixture.js";
import {
  conversionActor,
  conversionRequest,
} from "./type-conversion-fixture.js";

it.effect.prop(
  "settled exact titles convert only after the existing 250ms debounce and Undo restores the exact draft locally",
  {
    choice: Arbitrary.schema(
      Schema.Literals(["Focus", " Focus time ", "oOo", " OUT OF OFFICE "])
    ),
  },
  ({ choice }) =>
    Effect.gen(function* conversionHistory() {
      const actor = yield* conversionActor();
      yield* send(actor, {
        action: EditorAction.cases.TextEdited.make({
          field: "title",
          value: choice,
        }),
        type: "ACTION",
      });
      yield* waitFor(
        actor,
        (snapshot) =>
          snapshot.matches("editing") &&
          snapshot.context.session?.draft.title === choice
      ).pipe(Effect.orDie);
      const before = actor.getSnapshot().context.session?.draft;
      yield* TestClock.adjust(249);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(
        currentConversion(projectEditor(actor.getSnapshot()))
      ).toBeUndefined();
      expect(actor.getSnapshot().context.session?.draft.eventType).toBe(
        before?.eventType
      );
      yield* TestClock.adjust(1);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      const notice = currentConversion(projectEditor(actor.getSnapshot()));
      expect(notice?.target).toBe(
        choice.trim().toLowerCase().startsWith("focus")
          ? "focusTime"
          : "outOfOffice"
      );

      if (notice === undefined) {
        return;
      }

      const convertedDraft = actor.getSnapshot().context.session?.draft;
      yield* send(actor, {
        action: EditorAction.cases.UndoConversion.make({
          id: `${notice.id}:stale`,
        }),
        type: "ACTION",
      });
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(actor.getSnapshot().context.session?.draft).toEqual(
        convertedDraft
      );
      expect(currentConversion(projectEditor(actor.getSnapshot()))).toEqual(
        notice
      );
      yield* send(actor, {
        action: EditorAction.cases.UndoConversion.make({ id: notice.id }),
        type: "ACTION",
      });
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(actor.getSnapshot().context.session?.draft).toEqual(before);
      expect(
        currentConversion(projectEditor(actor.getSnapshot()))
      ).toBeUndefined();
      yield* TestClock.adjust(1000);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(actor.getSnapshot().context.session?.draft).toEqual(before);
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect.each([
  "Focus meeting",
  "OOO tomorrow",
  "Out-of-office",
  "Focus time!",
])("non-trigger title %s stays an ordinary draft", (title) =>
  Effect.gen(function* notATrigger() {
    const actor = yield* conversionActor();
    yield* send(actor, {
      action: EditorAction.cases.TextEdited.make({
        field: "title",
        value: title,
      }),
      type: "ACTION",
    });
    yield* waitFor(
      actor,
      (snapshot) =>
        snapshot.matches("editing") &&
        snapshot.context.session?.draft.title === title
    ).pipe(Effect.orDie);
    const original = actor.getSnapshot().context.session?.draft;
    yield* TestClock.adjust(1000);
    yield* Effect.yieldNow;
    yield* Effect.yieldNow;
    expect(actor.getSnapshot().context.session?.draft).toEqual(original);
    expect(
      currentConversion(projectEditor(actor.getSnapshot()))
    ).toBeUndefined();
  }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "a later keystroke cancels the old deadline and manual Event wins for the whole draft",
  () =>
    Effect.gen(function* manualHistory() {
      const actor = yield* conversionActor();

      const title = (value: string) =>
        send(actor, {
          action: EditorAction.cases.TextEdited.make({ field: "title", value }),
          type: "ACTION",
        });

      yield* title("Focus");
      yield* waitFor(
        actor,
        (snapshot) =>
          snapshot.matches("editing") &&
          snapshot.context.session?.draft.title === "Focus"
      ).pipe(Effect.orDie);
      yield* TestClock.adjust(200);
      yield* title("Focus meeting");
      yield* waitFor(
        actor,
        (snapshot) =>
          snapshot.matches("editing") &&
          snapshot.context.session?.draft.title === "Focus meeting"
      ).pipe(Effect.orDie);
      yield* TestClock.adjust(50);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(
        currentConversion(projectEditor(actor.getSnapshot()))
      ).toBeUndefined();
      yield* send(actor, {
        action: EditorAction.cases.EventTypeSelected.make({ value: "default" }),
        type: "ACTION",
      });
      yield* waitFor(actor, (snapshot) => snapshot.matches("editing")).pipe(
        Effect.orDie
      );
      yield* title("OOO");
      yield* waitFor(
        actor,
        (snapshot) =>
          snapshot.matches("editing") &&
          snapshot.context.session?.draft.title === "OOO"
      ).pipe(Effect.orDie);
      yield* TestClock.adjust(1000);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(actor.getSnapshot().context.session?.draft.eventType).toBe(
        "default"
      );
      expect(
        currentConversion(projectEditor(actor.getSnapshot()))
      ).toBeUndefined();
      yield* send(actor, {
        action: EditorAction.cases.Cancel.make({}),
        type: "ACTION",
      });
      yield* waitFor(actor, (snapshot) => snapshot.matches("closed")).pipe(
        Effect.orDie
      );
      yield* send(actor, { request: conversionRequest(), type: "OPEN" });
      yield* waitFor(actor, (snapshot) => snapshot.matches("editing")).pipe(
        Effect.orDie
      );
      yield* title("Focus");
      yield* waitFor(
        actor,
        (snapshot) =>
          snapshot.matches("editing") &&
          snapshot.context.session?.draft.title === "Focus"
      ).pipe(Effect.orDie);
      yield* TestClock.adjust(250);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(
        currentConversion(projectEditor(actor.getSnapshot()))?.target
      ).toBe("focusTime");
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect.each(["edit", "duplicate"] as const)(
  "%s sessions never auto-convert",
  (mode) =>
    Effect.gen(function* savedHistory() {
      const actor = yield* conversionActor(
        EditorRequest.cases.Existing.make({
          calendars: conversionRequest().calendars,
          event: {
            ...editorOriginal,
            attendees: [],
            recurringEventId: undefined,
            title: "Focus",
          },
          mode,
          navigation: conversionRequest().navigation,
          primaryZone: conversionRequest().primaryZone,
          selection: Option.none(),
        })
      );

      expect(actor.getSnapshot().context.session?.draft.title).toBe("Focus");
      yield* TestClock.adjust(1000);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(actor.getSnapshot().context.session?.draft.eventType).not.toBe(
        "focusTime"
      );
      expect(
        currentConversion(projectEditor(actor.getSnapshot()))
      ).toBeUndefined();
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "a conflicting later edit invalidates the receipt and stale Undo cannot lose it; reopen clears it",
  () =>
    Effect.gen(function* invalidationHistory() {
      const actor = yield* conversionActor();
      yield* send(actor, {
        action: EditorAction.cases.TextEdited.make({
          field: "title",
          value: "Focus",
        }),
        type: "ACTION",
      });
      yield* waitFor(
        actor,
        (snapshot) =>
          snapshot.matches("editing") &&
          snapshot.context.session?.draft.title === "Focus"
      ).pipe(Effect.orDie);
      yield* TestClock.adjust(250);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      const notice = currentConversion(projectEditor(actor.getSnapshot()));
      expect(notice).toBeDefined();

      if (notice === undefined) {
        return;
      }

      yield* send(actor, {
        action: EditorAction.cases.TextEdited.make({
          field: "title",
          value: "Newer work",
        }),
        type: "ACTION",
      });
      yield* waitFor(
        actor,
        (snapshot) =>
          snapshot.matches("editing") &&
          snapshot.context.session?.draft.title === "Newer work"
      ).pipe(Effect.orDie);
      expect(
        currentConversion(projectEditor(actor.getSnapshot()))
      ).toBeUndefined();
      const newer = actor.getSnapshot().context.session?.draft;
      yield* send(actor, {
        action: EditorAction.cases.UndoConversion.make({ id: notice.id }),
        type: "ACTION",
      });
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(actor.getSnapshot().context.session?.draft).toEqual(newer);
      yield* send(actor, {
        action: EditorAction.cases.Cancel.make({}),
        type: "ACTION",
      });
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(projectEditor(actor.getSnapshot())._tag).toBe("Closed");
      yield* send(actor, { request: conversionRequest(), type: "OPEN" });
      yield* waitFor(actor, (snapshot) => snapshot.matches("editing")).pipe(
        Effect.orDie
      );
      expect(
        currentConversion(projectEditor(actor.getSnapshot()))
      ).toBeUndefined();
      expect(
        Option.isNone(
          actor.getSnapshot().context.session?.original ?? Option.none()
        )
      ).toBe(true);
    }).pipe(Effect.provide(NodeServices.layer))
);

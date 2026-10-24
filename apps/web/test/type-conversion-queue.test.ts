import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { createEffectLogic, send } from "@xstate/effect";
import { Effect } from "effect";
import { TestClock } from "effect/testing";

import { changeEditor } from "../src/client/editing/change-editor.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import {
  eventEditorMachine,
  projectEditor,
} from "../src/client/editing/editor-machine.js";
import { currentConversion } from "../src/client/editing/editor-model.js";
import type { EditorChangeInput } from "../src/client/editing/editor-session-model.js";
import { EditorChangeResult } from "../src/client/editing/editor-session-model.js";
import {
  conversionActor,
  conversionRequest,
} from "./type-conversion-fixture.js";

const delayedChange = createEffectLogic({
  effect: ({ input }: { readonly input: typeof EditorChangeInput.Type }) =>
    Effect.sleep(1).pipe(
      Effect.andThen(changeEditor(input)),
      Effect.match({
        onFailure: (failure) =>
          EditorChangeResult.cases.Invalid.make({ message: failure.message }),
        onSuccess: (session) =>
          EditorChangeResult.cases.Changed.make({ session }),
      })
    ),
});

it.effect.each([
  "invalid-only",
  "invalid-followup",
  "valid-followup",
  "discard",
] as const)(
  "conversion controls during changing preserve ordered edits and discard safely: %s",
  (kind) =>
    Effect.gen(function* queuedUndo() {
      const extra = kind === "invalid-followup" || kind === "valid-followup";
      const valid = kind === "valid-followup";

      const actor = yield* conversionActor(
        conversionRequest(),
        false,
        eventEditorMachine.provide({ actors: { changeEditor: delayedChange } })
      );

      const originalType = actor.getSnapshot().context.session?.draft.eventType;

      const editTitle = (value: string) =>
        send(actor, {
          action: EditorAction.cases.TextEdited.make({ field: "title", value }),
          type: "ACTION",
        });

      yield* editTitle("Focus");
      yield* TestClock.adjust(1);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(actor.getSnapshot().matches("editing")).toBe(true);
      expect(actor.getSnapshot().context.session?.draft.title).toBe("Focus");
      yield* TestClock.adjust(250);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      const notice = currentConversion(projectEditor(actor.getSnapshot()));
      expect(notice).toBeDefined();

      if (notice === undefined) {
        return;
      }

      yield* editTitle(valid ? "Focus" : "Newer work");

      if (kind === "discard") {
        yield* send(actor, {
          action: EditorAction.cases.Cancel.make({}),
          type: "ACTION",
        });
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        expect(actor.getSnapshot().matches("closed")).toBe(true);
        expect(actor.getSnapshot().context.conversion).toBeUndefined();
        yield* TestClock.adjust(1);
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        expect(actor.getSnapshot().matches("closed")).toBe(true);
        expect(
          currentConversion(projectEditor(actor.getSnapshot()))
        ).toBeUndefined();

        return;
      }

      yield* send(actor, {
        action: EditorAction.cases.UndoConversion.make({ id: notice.id }),
        type: "ACTION",
      });

      if (extra) {
        yield* editTitle("Newest work");
      }

      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(actor.getSnapshot().matches("changing")).toBe(true);
      expect(
        actor
          .getSnapshot()
          .context.queue.some((action) =>
            EditorAction.guards.UndoConversion(action)
          )
      ).toBe(true);
      yield* TestClock.adjust(1);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;

      if (extra) {
        expect(actor.getSnapshot().context.action).toEqual(
          EditorAction.cases.TextEdited.make({
            field: "title",
            value: "Newest work",
          })
        );
        expect(actor.getSnapshot().matches("changing")).toBe(true);
        yield* TestClock.adjust(1);
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
      }

      expect(actor.getSnapshot().context.session?.draft.title).toBe(
        extra ? "Newest work" : "Newer work"
      );
      expect(actor.getSnapshot().matches("editing")).toBe(true);
      expect(actor.getSnapshot().context.queue).toEqual([]);
      expect(actor.getSnapshot().context.session?.draft.eventType).toBe(
        valid ? originalType : "focusTime"
      );
      expect(
        currentConversion(projectEditor(actor.getSnapshot()))
      ).toBeUndefined();
    }).pipe(Effect.provide(NodeServices.layer))
);

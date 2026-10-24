import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { send, waitFor } from "@xstate/effect";
import { Effect } from "effect";
import { TestClock } from "effect/testing";

import { EditorAction } from "../src/client/editing/editor-action.js";
import { projectEditor } from "../src/client/editing/editor-machine.js";
import { currentConversion } from "../src/client/editing/editor-model.js";
import { conversionActor } from "./type-conversion-fixture.js";

it.effect(
  "a newer conversion rejects the previous real receipt and restores only its own predecessor",
  () =>
    Effect.gen(function* receiptHistory() {
      const actor = yield* conversionActor();

      const typeTitle = (value: string) =>
        send(actor, {
          action: EditorAction.cases.TextEdited.make({ field: "title", value }),
          type: "ACTION",
        });

      yield* typeTitle("Focus");
      yield* waitFor(
        actor,
        (snapshot) =>
          snapshot.matches("editing") &&
          snapshot.context.session?.draft.title === "Focus"
      ).pipe(Effect.orDie);
      yield* TestClock.adjust(250);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      const first = currentConversion(projectEditor(actor.getSnapshot()));
      expect(first?.target).toBe("focusTime");

      if (first === undefined) {
        return;
      }

      yield* typeTitle("OOO");
      yield* waitFor(
        actor,
        (snapshot) =>
          snapshot.matches("editing") &&
          snapshot.context.session?.draft.title === "OOO"
      ).pipe(Effect.orDie);
      const previous = actor.getSnapshot().context.session?.draft;
      yield* TestClock.adjust(250);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      const second = currentConversion(projectEditor(actor.getSnapshot()));
      expect(second?.target).toBe("outOfOffice");
      expect(second?.id).not.toBe(first.id);

      if (second === undefined) {
        return;
      }

      const current = actor.getSnapshot().context.session?.draft;
      yield* send(actor, {
        action: EditorAction.cases.UndoConversion.make({ id: first.id }),
        type: "ACTION",
      });
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(actor.getSnapshot().context.session?.draft).toEqual(current);
      expect(currentConversion(projectEditor(actor.getSnapshot()))).toEqual(
        second
      );
      yield* send(actor, {
        action: EditorAction.cases.UndoConversion.make({ id: second.id }),
        type: "ACTION",
      });
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(actor.getSnapshot().context.session?.draft).toEqual(previous);
      expect(
        currentConversion(projectEditor(actor.getSnapshot()))
      ).toBeUndefined();
    }).pipe(Effect.provide(NodeServices.layer))
);

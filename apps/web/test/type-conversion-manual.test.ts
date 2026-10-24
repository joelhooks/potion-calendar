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
  "manually confirming the current type removes automatic Undo even without a field difference",
  () =>
    Effect.gen(function* manualReceipt() {
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
        action: EditorAction.cases.EventTypeSelected.make({
          value: "focusTime",
        }),
        type: "ACTION",
      });
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(actor.getSnapshot().context.manualType).toBe(true);
      expect(actor.getSnapshot().context.conversion).toBeUndefined();
      yield* waitFor(actor, (snapshot) => snapshot.matches("editing")).pipe(
        Effect.orDie
      );
      yield* send(actor, {
        action: EditorAction.cases.UndoConversion.make({ id: notice.id }),
        type: "ACTION",
      });
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(actor.getSnapshot().context.session?.draft.eventType).toBe(
        "focusTime"
      );
      expect(
        currentConversion(projectEditor(actor.getSnapshot()))
      ).toBeUndefined();
    }).pipe(Effect.provide(NodeServices.layer))
);

import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { send, waitFor } from "@xstate/effect";
import { Effect } from "effect";
import { TestClock } from "effect/testing";

import { EditorAction } from "../src/client/editing/editor-action.js";
import { projectEditor } from "../src/client/editing/editor-machine.js";
import { currentConversion } from "../src/client/editing/editor-model.js";
import {
  conversionActor,
  conversionRequest,
} from "./type-conversion-fixture.js";

it.effect.each(["save", "discard"] as const)(
  "%s removes the operation-specific receipt; a later stale Undo cannot reopen or convert the saved result",
  (terminal) =>
    Effect.gen(function* terminalHistory() {
      const actor = yield* conversionActor(
        conversionRequest(),
        terminal === "save"
      );

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
        action:
          terminal === "save"
            ? EditorAction.cases.Save.make({})
            : EditorAction.cases.Cancel.make({}),
        type: "ACTION",
      });
      yield* waitFor(actor, (snapshot) => snapshot.matches("closed")).pipe(
        Effect.orDie
      );
      expect(actor.getSnapshot().context.conversion).toBeUndefined();
      expect(
        currentConversion(projectEditor(actor.getSnapshot()))
      ).toBeUndefined();
      const closed = actor.getSnapshot().context;
      yield* send(actor, {
        action: EditorAction.cases.UndoConversion.make({ id: notice.id }),
        type: "ACTION",
      });
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(actor.getSnapshot().matches("closed")).toBe(true);
      expect(actor.getSnapshot().context).toEqual(closed);
    }).pipe(Effect.provide(NodeServices.layer))
);

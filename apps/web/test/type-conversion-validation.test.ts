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
  "a validation refusal preserves local Undo until a valid submission can reach the provider",
  () =>
    Effect.gen(function* validationRefusal() {
      const actor = yield* conversionActor();
      yield* send(actor, {
        action: EditorAction.cases.TextEdited.make({
          field: "endTime",
          value: "",
        }),
        type: "ACTION",
      });
      yield* waitFor(
        actor,
        (snapshot) =>
          snapshot.matches("editing") &&
          snapshot.context.session?.draft.endTime === ""
      ).pipe(Effect.orDie);
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
      const before = actor.getSnapshot().context.session?.draft;
      yield* TestClock.adjust(250);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      const notice = currentConversion(projectEditor(actor.getSnapshot()));
      expect(notice).toBeDefined();

      if (notice === undefined) {
        return;
      }

      yield* send(actor, {
        action: EditorAction.cases.Save.make({}),
        type: "ACTION",
      });
      yield* waitFor(
        actor,
        (snapshot) =>
          snapshot.matches("editing") && snapshot.context.error !== undefined
      ).pipe(Effect.orDie);
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
    }).pipe(Effect.provide(NodeServices.layer))
);

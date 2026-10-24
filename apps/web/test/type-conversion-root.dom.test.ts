import { expect, it } from "@effect/vitest";
import { Effect, Option, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Scene } from "foldkit/test";

import { update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import {
  currentConversion,
  EditorView,
} from "../src/client/editing/editor-model.js";
import {
  EditingCommand,
  EditingRuntime,
} from "../src/client/editing/runtime.js";
import { observeKeyboard } from "../src/client/keyboard/input.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import { unusedBrowserLayers } from "./browser-runtime-fixture.js";
import {
  createTypeRuntimeFixture,
  nextTypeNotice,
  renderTypeRoot,
} from "./create-type-runtime-fixture.js";
import { unexpectedSearchClient } from "./search-fixture.js";
import { conversionEditorScene as sceneView } from "./type-conversion-ui-fixture.js";
import { undoFixture } from "./undo-fixture.js";

it.effect.each(["toast", "Mod-Z", "Mod-Z no delete"] as const)(
  "the real title input reaches the root/editor actor and %s Undo restores locally without an RPC",
  (method) =>
    Effect.gen(function* rootConversionRecipient() {
      const f = yield* createTypeRuntimeFixture("event");
      const current = yield* Ref.get(f.state);
      const pending = undoFixture();

      const initial = {
        ...current,
        editing: {
          ...current.editing,
          deletes:
            method === "Mod-Z no delete" ? [] : pending.pending.editing.deletes,
        },
      };

      yield* Ref.set(f.state, initial);
      const sent: (typeof EditingCommand.Type)[] = [];

      const recordingRuntime = EditingRuntime.of({
        connect: (personId) => f.runtime.connect(personId),
        dispatch: (personId, command) =>
          Effect.sync(() => {
            sent.push(command);
          }).pipe(Effect.andThen(f.runtime.dispatch(personId, command))),
      });

      const messages: AppMessage[] = [];
      Scene.scene(
        {
          update: (model: AppModel, message: AppMessage) => {
            messages.push(message);

            return { model };
          },
          view: sceneView,
        },
        Scene.given(initial),
        Scene.type(Scene.selector("#event-title"), "Focus")
      );
      expect(messages).toHaveLength(1);

      const apply = Effect.fn("Conversion.executeReturnedRootCommands")(
        function* apply(message: AppMessage) {
          const result = update(yield* Ref.get(f.state), message);
          yield* Ref.set(f.state, result.model);
          expect(result.commands?.map((command) => command.name)).toEqual([
            "DispatchEditing",
          ]);

          for (const command of result.commands ?? []) {
            yield* command.effect.pipe(
              Effect.provide(unusedBrowserLayers),
              Effect.provideService(
                CalendarSearchClient,
                unexpectedSearchClient
              ),
              Effect.provideService(EditingRuntime, recordingRuntime)
            );
          }
        }
      );

      const [typed] = messages;
      expect(typed).toBeDefined();

      if (typed === undefined) {
        return;
      }

      yield* apply(typed);

      const before = yield* nextTypeNotice(
        f.queue,
        (notice) =>
          EditorView.guards.Editing(notice.view) &&
          notice.view.draft.title === "Focus"
      );

      expect(EditorView.guards.Editing(before.view)).toBe(true);

      if (!EditorView.guards.Editing(before.view)) {
        return;
      }

      const beforeDraft = before.view.draft;
      yield* TestClock.adjust(250);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      const converted = yield* Ref.get(f.state);
      const notice = currentConversion(converted.editing.view);
      expect(notice?.target).toBe("focusTime");

      if (notice === undefined) {
        return;
      }

      yield* nextTypeNotice(
        f.queue,
        (row) => currentConversion(row.view)?.id === notice.id
      );
      const rendered = yield* renderTypeRoot(converted);
      expect(rendered.html).toContain("Converted to Focus time");
      expect(rendered.html).toContain("data-conversion-undo");

      if (method !== "Mod-Z no delete") {
        expect(rendered.html).toContain(
          `data-undo-intent="${pending.intent.id}"`
        );
      }

      let undo: AppMessage | undefined;

      if (method === "toast") {
        Scene.scene(
          {
            update: (model: AppModel, message: AppMessage) => {
              undo = message;

              return { model };
            },
            view: sceneView,
          },
          Scene.given(converted),
          Scene.click(Scene.selector("[data-conversion-undo] button"))
        );
      } else {
        const input = document.createElement("input");
        document.body.append(input);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            input.remove();
          })
        );
        input.addEventListener("keydown", (event) => {
          undo = Option.getOrUndefined(observeKeyboard(converted, event, 0));
        });

        const event = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "z",
        });

        input.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
      }

      expect(undo).toBeDefined();

      if (undo === undefined) {
        return;
      }

      yield* apply(undo);
      expect(sent.at(-1)).toEqual(
        EditingCommand.cases.Action.make({
          action: EditorAction.cases.UndoConversion.make({ id: notice.id }),
        })
      );

      const restored = yield* nextTypeNotice(
        f.queue,
        (result) =>
          EditorView.guards.Editing(result.view) &&
          currentConversion(result.view) === undefined
      );

      expect(EditorView.guards.Editing(restored.view)).toBe(true);

      if (EditorView.guards.Editing(restored.view)) {
        expect(restored.view.draft).toEqual(beforeDraft);
      }

      expect((yield* Ref.get(f.state)).editing.deletes).toEqual(
        initial.editing.deletes
      );
      expect(f.api.requests).toEqual([]);
      expect(yield* Ref.get(f.api.fake.requests)).toEqual([]);
      expect(yield* Ref.get(f.api.fake.receipts)).toEqual([]);
      const afterUndo = yield* Ref.get(f.state);
      const text = document.createElement("input");
      document.body.append(text);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          text.remove();
        })
      );
      let textUndo = Option.none<AppMessage>();
      text.addEventListener("keydown", (event) => {
        textUndo = observeKeyboard(afterUndo, event, 1);
      });

      const nativeUndo = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: "z",
      });

      text.dispatchEvent(nativeUndo);
      expect(Option.isNone(textUndo)).toBe(true);
      expect(nativeUndo.defaultPrevented).toBe(false);
      yield* TestClock.adjust(1000);
      expect(
        currentConversion((yield* Ref.get(f.state)).editing.view)
      ).toBeUndefined();
      yield* f.dispatch(EditorAction.cases.Cancel.make({}));
    })
);

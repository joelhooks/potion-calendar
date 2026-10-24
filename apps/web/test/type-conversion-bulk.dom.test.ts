import { expect, it } from "@effect/vitest";
import { Effect, Option, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";

import { Message, update } from "../src/client/app.js";
import type { AppMessage, AppModel } from "../src/client/app.js";
import { BulkExecution, BulkView } from "../src/client/bulk/model.js";
import { bulkPlanFor } from "../src/client/bulk/selection.js";
import { DeleteIntent } from "../src/client/editing/delete-actor.js";
import { DeleteCommand } from "../src/client/editing/deletion-session.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import {
  currentConversion,
  EditorView,
} from "../src/client/editing/editor-model.js";
import { EditorMutation } from "../src/client/editing/editor-session-model.js";
import {
  EditingCommand,
  EditingRuntime,
} from "../src/client/editing/runtime.js";
import { DeleteMark } from "../src/client/editing/ui-model.js";
import { observeKeyboard } from "../src/client/keyboard/input.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import { BulkReceipt, BulkUndo } from "../src/layout/bulk-plans.js";
import { unusedBrowserLayers } from "./browser-runtime-fixture.js";
import { bulkRootFixture } from "./bulk-root-fixture.js";
import {
  createTypeRuntimeFixture,
  nextTypeNotice,
} from "./create-type-runtime-fixture.js";
import { unexpectedSearchClient } from "./search-fixture.js";
import { conversionInputMessage } from "./type-conversion-ui-fixture.js";

const busyBulk = (mode: "Running" | "Undoing") => {
  const base = bulkRootFixture();
  const selection = base.keys.slice(0, 2);

  const plan = bulkPlanFor(
    {
      ...base.model,
      calendar: { ...base.model.calendar, selected: selection },
    },
    "delete"
  );

  expect(plan.steps).toHaveLength(2);

  const marks = plan.steps.map((step, index) =>
    DeleteMark.make({
      afterRead: Option.none(),
      intent: DeleteIntent.make({
        event: step.request.event,
        id: `busy-delete-${index}`,
        navigation: step.request.navigation,
        request: {
          accountId: step.request.event.accountId,
          calendarId: step.request.event.calendarId,
          eventId: step.request.event.eventId,
          scope: "single",
          sendUpdates: "none",
        },
        selection: step.request.selection,
        title: step.request.event.title ?? "Event",
      }),
      phase: "pending",
    })
  );

  const execution = BulkExecution.make({
    id: "unrelated-bulk",
    mutations: marks.map((mark) =>
      EditorMutation.cases.DeletedStaged.make({
        id: mark.intent.id,
        intent: mark.intent,
      })
    ),
    plan,
    receipts: plan.steps.map((step, index) =>
      BulkReceipt.cases.Succeeded.make({
        key: step.key,
        undo: BulkUndo.cases.Available.make({
          request: DeleteCommand.cases.Undo.make({
            id: `busy-delete-${index}`,
          }),
        }),
      })
    ),
    selection,
  });

  return {
    marks,
    view:
      mode === "Running"
        ? BulkView.cases.Running.make({ id: execution.id, plan, selection })
        : BulkView.cases.Undoing.make({ execution }),
  };
};

const modZ = (
  model: AppModel,
  tag: "input" | "div",
  now: number
): AppMessage => {
  const target: HTMLElement = document.createElement(tag);
  document.body.append(target);
  let received = Option.none<AppMessage>();
  target.addEventListener("keydown", (event) => {
    received = observeKeyboard(model, event, now);
  });

  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
    key: "z",
  });

  try {
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(Option.isSome(received)).toBe(true);

    return Option.getOrThrow(received);
  } finally {
    target.remove();
  }
};

it.effect.each(["Running", "Undoing"] as const)(
  "only local conversion Undo crosses the busy %s guard through the exact returned root command",
  (mode) =>
    Effect.gen(function* busyBulkRecipient() {
      const f = yield* createTypeRuntimeFixture("event");
      yield* f.editText("title", "Focus");

      const before = yield* Schema.decodeUnknownEffect(
        EditorView.cases.Editing
      )((yield* Ref.get(f.state)).editing.view);

      yield* TestClock.adjust(250);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      const converted = yield* Ref.get(f.state);
      const notice = currentConversion(converted.editing.view);
      expect(notice).toBeDefined();

      if (notice === undefined) {
        return;
      }

      yield* nextTypeNotice(
        f.queue,
        (row) => currentConversion(row.view)?.id === notice.id
      );
      const busy = busyBulk(mode);
      const beforeBulk = JSON.stringify(busy.view);
      const beforeMarks = JSON.stringify(busy.marks);

      const model = {
        ...converted,
        editing: { ...converted.editing, bulk: busy.view, deletes: busy.marks },
      };

      yield* Ref.set(f.state, model);

      const manual = update(
        model,
        conversionInputMessage(model, "#event-title", "Must be refused")
      );

      expect(manual.commands ?? []).toEqual([]);
      expect(manual.model.editing.view).toEqual(model.editing.view);
      expect(manual.model.editing.bulk).toEqual(busy.view);

      for (const action of [
        EditorAction.cases.Save.make({}),
        EditorAction.cases.Undo.make({ id: "busy-delete-0" }),
      ]) {
        const guarded = update(
          model,
          Message.EditingAction({
            action,
            personId: Option.getOrUndefined(model.person),
          })
        );

        expect(guarded.commands ?? []).toEqual([]);
        expect(guarded.model.editing.bulk).toEqual(busy.view);
      }

      const sent: (typeof EditingCommand.Type)[] = [];

      const recorder = EditingRuntime.of({
        connect: (personId) => f.runtime.connect(personId),
        dispatch: (personId, command) =>
          Effect.sync(() => {
            sent.push(command);
          }).pipe(Effect.andThen(f.runtime.dispatch(personId, command))),
      });

      const result = update(model, modZ(model, "input", 0));
      expect(result.commands?.map((command) => command.name)).toEqual([
        "DispatchEditing",
      ]);
      expect(result.model.editing.bulk).toEqual(busy.view);
      yield* Ref.set(f.state, result.model);

      for (const command of result.commands ?? []) {
        yield* command.effect.pipe(
          Effect.provide(unusedBrowserLayers),
          Effect.provideService(CalendarSearchClient, unexpectedSearchClient),
          Effect.provideService(EditingRuntime, recorder)
        );
      }

      expect(sent).toEqual([
        EditingCommand.cases.Action.make({
          action: EditorAction.cases.UndoConversion.make({ id: notice.id }),
        }),
      ]);

      const restored = yield* nextTypeNotice(
        f.queue,
        (row) =>
          EditorView.guards.Editing(row.view) &&
          currentConversion(row.view) === undefined
      );

      const restoredView = yield* Schema.decodeUnknownEffect(
        EditorView.cases.Editing
      )(restored.view);

      expect(restoredView.draft).toEqual(before.draft);
      const after = yield* Ref.get(f.state);
      expect(after.editing.bulk).toEqual(busy.view);
      expect(after.editing.deletes).toEqual(busy.marks);
      expect(JSON.stringify(after.editing.bulk)).toBe(beforeBulk);
      expect(JSON.stringify(after.editing.deletes)).toBe(beforeMarks);
      expect(f.api.requests).toEqual([]);
      expect(yield* Ref.get(f.api.fake.requests)).toEqual([]);
      expect(yield* Ref.get(f.api.fake.receipts)).toEqual([]);
      const guardedFallback = update(after, modZ(after, "div", 1));
      expect(guardedFallback.commands ?? []).toEqual([]);
      expect(guardedFallback.model.editing.bulk).toEqual(busy.view);
      expect(guardedFallback.model.editing.deletes).toEqual(busy.marks);
      expect(JSON.stringify(guardedFallback.model.editing.bulk)).toBe(
        beforeBulk
      );
      expect(JSON.stringify(guardedFallback.model.editing.deletes)).toBe(
        beforeMarks
      );
      expect(f.api.requests).toEqual([]);
      expect(yield* Ref.get(f.api.fake.requests)).toEqual([]);
      expect(yield* Ref.get(f.api.fake.receipts)).toEqual([]);
    })
);

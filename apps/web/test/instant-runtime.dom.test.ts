import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";

import { Message } from "../src/client/app.js";
import { BulkView } from "../src/client/bulk/model.js";
import { bulkSummary } from "../src/client/bulk/selection.js";
import {
  DeleteOutcome,
  undoWindowMilliseconds,
} from "../src/client/editing/delete-actor.js";
import { DeleteNotice } from "../src/client/editing/deletion-session.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import {
  EditorMutation,
  LoadedEditor,
} from "../src/client/editing/editor-session-model.js";
import { prepareEditor } from "../src/client/editing/prepare-editor.js";
import { EditingNotice } from "../src/client/editing/runtime.js";
import {
  editorCalendars,
  editorDraft,
  editorOriginal,
} from "./editor-fixture.js";
import { fixtureModel } from "./fixture.js";
import {
  instantRuntimeFixture,
  nextInstantNotice,
} from "./instant-runtime-fixture.js";

const editingView = (notice: typeof EditingNotice.Type) =>
  EditingNotice.guards.Editor(notice) && EditorView.guards.Editing(notice.view);

const staged = (notice: typeof EditingNotice.Type) =>
  EditingNotice.guards.Editor(notice) &&
  Option.isSome(notice.mutation) &&
  EditorMutation.guards.DeletedStaged(notice.mutation.value);

const saved = (notice: typeof EditingNotice.Type) =>
  EditingNotice.guards.Editor(notice) &&
  Option.isSome(notice.mutation) &&
  EditorMutation.guards.Saved(notice.mutation.value);

it.effect.prop(
  "every instant alias and save reaches fake Google with no email and single occurrence; staged delete writes only at commit and never after Undo",
  {
    alias: Schema.Literals(["Delete", "Backspace", "Del"]),
    operation: Schema.Literals(["delete", "save"]),
    organizer: Schema.Boolean,
    recurring: Schema.Boolean,
    undo: Schema.Boolean,
  },
  ({ alias, ...input }) =>
    Effect.gen(function* instantProviderHistory() {
      const h = yield* instantRuntimeFixture(input);

      if (input.operation === "save") {
        yield* h.dispatch(
          Message.EditingAction({
            action: EditorAction.cases.OpenEdit.make({}),
          })
        );
        yield* nextInstantNotice(h.queue, editingView);
        yield* h.dispatch(
          Message.EditingAction({
            action: EditorAction.cases.TextEdited.make({
              field: "endTime",
              value: "12:00",
            }),
          })
        );
        yield* nextInstantNotice(
          h.queue,
          (notice) =>
            editingView(notice) &&
            EditingNotice.guards.Editor(notice) &&
            EditorView.guards.Editing(notice.view) &&
            notice.view.draft.endTime === "12:00"
        );
        yield* h.dispatch(
          Message.EditingAction({
            action: EditorAction.cases.TextEdited.make({
              field: "startTime",
              value: "11:00",
            }),
          })
        );
        yield* nextInstantNotice(
          h.queue,
          (notice) =>
            EditingNotice.guards.Editor(notice) &&
            EditorView.guards.Editing(notice.view) &&
            notice.view.draft.startTime === "11:00"
        );
      }

      yield* h.dispatch(
        Message.PressedCalendarKey({
          alt: false,
          key: input.operation === "save" ? "Enter" : alias,
          mod: true,
          shift: true,
        })
      );
      yield* nextInstantNotice(
        h.queue,
        input.operation === "save" ? saved : staged
      );
      let requests = yield* Ref.get(h.api.fake.requests);

      if (input.operation === "delete") {
        expect(requests.every((request) => request.method === "GET")).toBe(
          true
        );
        const count = requests.length;

        const mark = (yield* Ref.get(h.state)).editing.deletes.find(
          (item) => item.phase === "pending"
        );

        if (mark === undefined) {
          return yield* Effect.die(
            "Instant delete did not stage an Undo intent"
          );
        }

        expect(mark.intent.request.scope).toBe("single");
        expect(mark.intent.request.sendUpdates).toBe("none");
        yield* h.dispatch(
          Message.EditingAction({
            action: input.undo
              ? EditorAction.cases.Undo.make({ id: mark.intent.id })
              : EditorAction.cases.DismissUndo.make({ id: mark.intent.id }),
          })
        );
        yield* nextInstantNotice(
          h.queue,
          (notice) =>
            EditingNotice.guards.Delete(notice) &&
            DeleteNotice.guards.Settled(notice.notice) &&
            (input.undo
              ? DeleteOutcome.guards.Undone(notice.notice.outcome)
              : DeleteOutcome.guards.Committed(notice.notice.outcome))
        );

        if (input.undo) {
          yield* TestClock.adjust(undoWindowMilliseconds + 1);
          requests = yield* Ref.get(h.api.fake.requests);
          expect(requests).toHaveLength(count);
        } else {
          requests = yield* Ref.get(h.api.fake.requests);
        }
      }

      const writes = requests.filter((request) => request.method !== "GET");
      expect(writes).toHaveLength(
        input.operation === "delete" && input.undo ? 0 : 1
      );

      for (const write of writes) {
        expect(
          new URL(write.path, "https://fixture.invalid").searchParams.get(
            "sendUpdates"
          )
        ).toBe("none");
        expect(write.path).toContain("/events/instant-instance");
        expect(write.path).not.toContain("/events/instant-series");
      }

      if (input.operation === "save") {
        const notice = Option.getOrThrow(
          (yield* Ref.get(h.state)).editing.instantSaved
        );

        expect(notice.sendUpdates).toBe("none");
        expect(notice.title).toBe(h.source.title);
        yield* h.dispatch(
          Message.EditingAction({
            action: EditorAction.cases.DismissInstantSave.make({
              id: notice.id,
            }),
          })
        );
        expect((yield* Ref.get(h.state)).editing.instantSaved).toEqual(
          Option.none()
        );
      }

      expect(h.views).not.toContain("Email");
      expect(h.views).not.toContain("Scope");
      expect(h.views).not.toContain("RemoveRecurrence");

      return yield* Effect.void;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

it.effect.prop(
  "mixed instant selection uses the bulk writer, skips unsupported types and commits each eligible event without email",
  {
    alias: Schema.Literals(["Delete", "Backspace", "Del"]),
    organizer: Schema.Boolean,
  },
  ({ alias, organizer }) =>
    Effect.gen(function* mixedInstantDelete() {
      const h = yield* instantRuntimeFixture({
        bulk: true,
        operation: "delete",
        organizer,
        recurring: false,
        undo: false,
      });

      yield* h.dispatch(
        Message.PressedCalendarKey({
          alt: false,
          key: alias,
          mod: true,
          shift: true,
        })
      );
      yield* nextInstantNotice(
        h.queue,
        (notice) =>
          EditingNotice.guards.Bulk(notice) &&
          BulkView.guards.Settled(notice.view)
      );
      const model = yield* Ref.get(h.state);
      expect(bulkSummary(model)?.succeeded).toHaveLength(2);
      expect(bulkSummary(model)?.skipped).toHaveLength(1);
      expect(
        (yield* Ref.get(h.api.fake.requests)).every(
          (request) => request.method === "GET"
        )
      ).toBe(true);

      const pending = model.editing.deletes.filter(
        (mark) => mark.phase === "pending"
      );

      expect(pending).toHaveLength(2);

      for (const mark of pending) {
        yield* h.dispatch(
          Message.EditingAction({
            action: EditorAction.cases.DismissUndo.make({ id: mark.intent.id }),
          })
        );
        yield* nextInstantNotice(
          h.queue,
          (notice) =>
            EditingNotice.guards.Delete(notice) &&
            DeleteNotice.guards.Settled(notice.notice) &&
            DeleteOutcome.guards.Committed(notice.notice.outcome) &&
            notice.notice.outcome.id === mark.intent.id
        );
      }

      const writes = (yield* Ref.get(h.api.fake.requests)).filter(
        (request) => request.method !== "GET"
      );

      expect(writes).toHaveLength(2);

      for (const write of writes) {
        expect(
          new URL(write.path, "https://fixture.invalid").searchParams.get(
            "sendUpdates"
          )
        ).toBe("none");
        expect(write.path).not.toContain("instant-blocked");
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

it.effect(
  "a recurring calendar move retains the normal scope and email decisions",
  () =>
    Effect.gen(function* calendarMoveFallback() {
      const calendar = editorCalendars.find(
        (item) => item.accountId === "work" && item.calendarId === "primary"
      );

      if (calendar === undefined) {
        return yield* Effect.die("Missing source calendar");
      }

      const session = LoadedEditor.make({
        baseline: editorDraft,
        calendars: [
          ...editorCalendars,
          { ...calendar, calendarId: "team", primary: false },
        ],
        createId: Option.none(),
        draft: { ...editorDraft, calendarId: "team" },
        id: "calendar-move",
        intent: "noEmailOccurrence",
        kind: "edit",
        master: Option.none(),
        moveSupport: "available",
        navigation: fixtureModel().calendar.navigation,
        operation: "save",
        original: Option.some(editorOriginal),
        selection: Option.none(),
      });

      const plan = yield* prepareEditor(session);
      expect(plan.calendarMoved).toBe(true);
      expect(plan.prompt).toBe("scope");
      expect(plan.choices).not.toContain("single");
      expect(plan.emailNeeded).toBe(true);
      expect(plan.session.intent).toBe("ordinary");

      return yield* Effect.void;
    })
);

it.effect(
  "a series-pattern change uses normal recurrence and email dialogs instead of silently sending none",
  () =>
    Effect.gen(function* seriesFallback() {
      const h = yield* instantRuntimeFixture({
        operation: "save",
        organizer: true,
        recurring: true,
        undo: false,
      });

      yield* h.dispatch(
        Message.EditingAction({ action: EditorAction.cases.OpenEdit.make({}) })
      );
      yield* nextInstantNotice(h.queue, editingView);
      yield* h.dispatch(
        Message.EditingAction({
          action: EditorAction.cases.RepeatPresetSelected.make({
            value: "weekly",
          }),
        })
      );
      yield* nextInstantNotice(
        h.queue,
        (notice) =>
          editingView(notice) &&
          EditingNotice.guards.Editor(notice) &&
          EditorView.guards.Editing(notice.view) &&
          notice.view.draft.repeat.preset === "weekly"
      );
      yield* h.dispatch(
        Message.PressedCalendarKey({
          alt: false,
          key: "Enter",
          mod: true,
          shift: true,
        })
      );
      yield* nextInstantNotice(
        h.queue,
        (notice) =>
          EditingNotice.guards.Editor(notice) &&
          EditorView.guards.Scope(notice.view)
      );
      yield* h.dispatch(
        Message.EditingAction({
          action: EditorAction.cases.ConfirmScope.make({}),
        })
      );
      yield* nextInstantNotice(
        h.queue,
        (notice) =>
          EditingNotice.guards.Editor(notice) &&
          EditorView.guards.Email(notice.view)
      );
      expect(
        (yield* Ref.get(h.api.fake.requests)).every(
          (request) => request.method === "GET"
        )
      ).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { createEffectLogic, send, waitFor } from "@xstate/effect";
import { Deferred, Effect, Ref, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import {
  eventEditorMachine,
  projectEditor,
} from "../src/client/editing/editor-machine.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { EditorRequest } from "../src/client/editing/editor-session-model.js";
import type { LoadedEditor } from "../src/client/editing/editor-session-model.js";
import { selectCreateEventType } from "../src/client/editing/status-event-draft.js";
import { commandChoices } from "../src/client/keyboard/choices.js";
import {
  commandTypeActor,
  commandTypeFixture,
} from "./command-type-fixture.js";
import { editorOriginal } from "./editor-fixture.js";
import { conversionRequest } from "./type-conversion-fixture.js";

const Type = Schema.Literals(["default", "focusTime", "outOfOffice"]);

it.effect(
  "an edit arriving during command conversion is preserved and invalidates Undo",
  () =>
    Effect.gen(function* queuedCommandEdit() {
      const release = yield* Deferred.make<boolean>();

      const machine = eventEditorMachine.provide({
        actors: {
          typeConversion: createEffectLogic({
            effect: ({
              input,
            }: {
              readonly input: {
                readonly manual: boolean;
                readonly session: typeof LoadedEditor.Type;
                readonly target?: typeof Type.Type | undefined;
              };
            }) =>
              input.target === undefined
                ? Effect.succeedNone
                : Deferred.await(release).pipe(
                    Effect.andThen(
                      selectCreateEventType(input.session, input.target)
                    ),
                    Effect.option
                  ),
          }),
        },
      });

      const { actor, writes } = yield* commandTypeActor(
        conversionRequest(),
        machine
      );

      const { session } = actor.getSnapshot().context;
      yield* send(actor, {
        action: EditorAction.cases.ConvertType.make({
          sessionId: session?.id ?? "missing",
          value: "focusTime",
        }),
        type: "ACTION",
      });
      yield* waitFor(actor, (snapshot) => snapshot.matches("converting")).pipe(
        Effect.orDie
      );
      yield* send(actor, {
        action: EditorAction.cases.TextEdited.make({
          field: "title",
          value: "Keep the newer title",
        }),
        type: "ACTION",
      });
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(
        actor.getSnapshot().context.queue,
        "newer input is queued during conversion"
      ).toContainEqual(
        EditorAction.cases.TextEdited.make({
          field: "title",
          value: "Keep the newer title",
        })
      );
      yield* Deferred.succeed(release, true);
      yield* waitFor(
        actor,
        (snapshot) =>
          snapshot.matches("editing") &&
          snapshot.context.session?.draft.eventType === "focusTime"
      ).pipe(Effect.orDie);
      expect(
        actor.getSnapshot().context.session?.draft.title,
        `conversion must not swallow a newer draft edit: ${JSON.stringify({ action: actor.getSnapshot().context.action, error: actor.getSnapshot().context.error, queue: actor.getSnapshot().context.queue })}`
      ).toBe("Keep the newer title");
      expect(actor.getSnapshot().context.conversion).toBeUndefined();
      expect(yield* Ref.get(writes)).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect.each(["location", "description", "participantEmail"] as const)(
  "%s loss refuses a real actor command without changing fields or writing",
  (field) =>
    Effect.gen(function* losslessCommandRefusal() {
      const { actor, writes } = yield* commandTypeActor();
      yield* send(actor, {
        action: EditorAction.cases.TextEdited.make({
          field,
          value: "Keep this input",
        }),
        type: "ACTION",
      });
      yield* waitFor(
        actor,
        (snapshot) =>
          snapshot.matches("editing") &&
          snapshot.context.session?.draft[field] === "Keep this input"
      ).pipe(Effect.orDie);
      const before = actor.getSnapshot().context.session;
      expect(
        commandChoices(
          commandTypeFixture(projectEditor(actor.getSnapshot()))
        ).some((choice) => choice.id === "event-type")
      ).toBe(false);
      yield* send(actor, {
        action: EditorAction.cases.ConvertType.make({
          sessionId: before?.id ?? "missing",
          value: "focusTime",
        }),
        type: "ACTION",
      });
      yield* waitFor(actor, (snapshot) => snapshot.matches("editing")).pipe(
        Effect.orDie
      );
      expect(actor.getSnapshot().context.session).toEqual(before);
      expect(actor.getSnapshot().context.conversion).toBeUndefined();
      expect(
        yield* Ref.get(writes),
        "zero POST, PATCH and DELETE on loss refusal"
      ).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect.each([
  "duplicate",
  "saving",
  "non-editable",
  "closed",
  "all-day",
  "non-primary",
  "attendees",
  "attachment",
  "conferencing",
  "invitation-policy",
] as const)("%s never offers an unsafe type target", (guard) =>
  Effect.gen(function* menuTypeGuard() {
    const { actor, writes } = yield* commandTypeActor();
    const view = projectEditor(actor.getSnapshot());

    if (!EditorView.guards.Editing(view)) {
      throw new Error("Expected an editable fixture");
    }

    const { draft } = view;
    let changed: typeof EditorView.Type = view;

    switch (guard) {
      case "duplicate": {
        changed = { ...view, kind: "duplicate" };
        break;
      }

      case "saving": {
        const { _tag, ...fields } = view;
        expect(_tag).toBe("Editing");
        changed = EditorView.cases.Saving.make(fields);
        break;
      }

      case "non-editable": {
        changed = {
          ...view,
          permissions: { ...view.permissions, editMeeting: false },
        };
        break;
      }

      case "closed": {
        changed = EditorView.cases.Closed.make({});
        break;
      }

      case "all-day": {
        changed = { ...view, draft: { ...draft, allDay: true } };
        break;
      }

      case "non-primary": {
        changed = { ...view, draft: { ...draft, calendarId: "team" } };
        break;
      }

      case "attendees": {
        changed = {
          ...view,
          draft: { ...draft, attendees: [{ email: "guest@example.test" }] },
        };
        break;
      }

      case "attachment": {
        changed = {
          ...view,
          draft: {
            ...draft,
            attachments: [{ url: "https://files.example.test/document" }],
          },
        };
        break;
      }

      case "conferencing": {
        changed = {
          ...view,
          draft: {
            ...draft,
            conferencing: {
              participantSeen: false,
              request: { kind: "googleMeet" },
            },
          },
        };
        break;
      }

      case "invitation-policy": {
        changed = {
          ...view,
          draft: { ...draft, statusInvitationChoice: "declineNone" },
        };
        break;
      }

      default: {
        throw new Error("Unrepresented type refusal");
      }
    }

    const model = commandTypeFixture(changed);
    expect(
      commandChoices(model).some((choice) => choice.id === "event-type")
    ).toBe(false);
    expect(
      update(model, Message.KeyboardAction({ id: "event-type" })).model.keyboard
        .screen
    ).toBe("commands");
    expect(
      yield* Ref.get(writes),
      "zero POST, PATCH and DELETE on menu refusal"
    ).toEqual([]);
  }).pipe(Effect.provide(NodeServices.layer))
);

it.effect.prop(
  "current type is omitted and every other eligible type is an explicit choice",
  { current: Type },
  ({ current }) =>
    Effect.gen(function* typeOmission() {
      const { actor } = yield* commandTypeActor();
      const view = projectEditor(actor.getSnapshot());
      expect(EditorView.guards.Editing(view)).toBe(true);

      if (!EditorView.guards.Editing(view)) {
        return;
      }

      const base = commandTypeFixture({
        ...view,
        draft: { ...view.draft, eventType: current },
      });

      const { model } = update(
        base,
        Message.KeyboardAction({ id: "event-type" })
      );

      expect(commandChoices(model).map((choice) => choice.id)).toEqual(
        ["default", "focusTime", "outOfOffice"].flatMap((type) =>
          type === current ? [] : [`type-${type}`]
        )
      );
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect("saved event never offers type conversion", () =>
  Effect.gen(function* savedTypeRefusal() {
    const base = conversionRequest();

    const { actor, writes } = yield* commandTypeActor(
      EditorRequest.cases.Existing.make({
        calendars: base.calendars,
        event: { ...editorOriginal, attendees: [] },
        mode: "edit",
        navigation: base.navigation,
        primaryZone: base.primaryZone,
        selection: base.selection,
      })
    );

    const before = actor.getSnapshot().context;
    const view = projectEditor(actor.getSnapshot());
    expect(
      commandChoices(commandTypeFixture(view)).some(
        (choice) => choice.id === "event-type"
      ),
      "saved event never offers type conversion"
    ).toBe(false);
    yield* send(actor, {
      action: EditorAction.cases.ConvertType.make({
        sessionId: before.session?.id ?? "missing",
        value: "focusTime",
      }),
      type: "ACTION",
    });
    yield* Effect.yieldNow;
    yield* Effect.yieldNow;
    expect(
      actor.getSnapshot().context,
      "saved conversion is refused before any writer"
    ).toEqual(before);
    expect(
      yield* Ref.get(writes),
      "zero POST, PATCH and DELETE on saved refusal"
    ).toEqual([]);
  }).pipe(Effect.provide(NodeServices.layer))
);

it.effect("stale type command cannot modify a replacement draft", () =>
  Effect.gen(function* staleTypeRefusal() {
    const { actor, writes } = yield* commandTypeActor();
    const first = actor.getSnapshot().context.session;
    expect(first).toBeDefined();
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
    const before = actor.getSnapshot().context;
    expect(before.session?.id).not.toBe(first?.id);
    yield* send(actor, {
      action: EditorAction.cases.ConvertType.make({
        sessionId: first?.id ?? "missing",
        value: "focusTime",
      }),
      type: "ACTION",
    });
    yield* Effect.yieldNow;
    yield* Effect.yieldNow;
    yield* Effect.yieldNow;
    expect(
      actor.getSnapshot().context.session?.draft,
      "stale type command cannot modify a replacement draft"
    ).toEqual(before.session?.draft);
    expect(actor.getSnapshot().context.conversion).toEqual(before.conversion);
    expect(
      yield* Ref.get(writes),
      "zero POST, PATCH and DELETE on stale refusal"
    ).toEqual([]);
  }).pipe(Effect.provide(NodeServices.layer))
);

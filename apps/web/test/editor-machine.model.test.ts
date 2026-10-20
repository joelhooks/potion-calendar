import {
  Provider,
  SeriesMoveRetimePartial,
  SeriesMoveRetimeUncertain,
} from "@calendar/calendar/contracts";
import type {
  CalendarEventValue,
  CreateEventInput,
  UpdateEventInput,
} from "@calendar/calendar/contracts";
import { watchActor } from "@calendar/capability/actor-watch";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { createEffectActor, send, snapshots } from "@xstate/effect";
import type { EffectActor } from "@xstate/effect";
import { Crypto, Effect, Option, Queue, Schema, Stream } from "effect";

import { Message, update } from "../src/client/app.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionWriter } from "../src/client/editing/delete-actor.js";
import { DeletionSession } from "../src/client/editing/deletion-session.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import {
  eventEditorMachine,
  projectEditor,
} from "../src/client/editing/editor-machine.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { EditorRequest } from "../src/client/editing/editor-session-model.js";
import { MutationFailure } from "../src/client/editing/failure.js";
import type { MutationFailureValue } from "../src/client/editing/failure.js";
import {
  EditingCommand,
  EditingNotice,
} from "../src/client/editing/runtime.js";
import { dayFromIso, initialNavigation } from "../src/layout/navigation.js";
import {
  editorCalendars,
  editorDraft,
  editorOriginal,
} from "./editor-fixture.js";
import { keyboardFixture } from "./keyboard-fixture.js";

type EditorActor = EffectActor<typeof eventEditorMachine>;

const existingRequest = (mode: "edit" | "delete" | "duplicate" = "edit") =>
  EditorRequest.cases.Existing.make({
    calendars: editorCalendars,
    event: editorOriginal,
    mode,
    navigation: initialNavigation(dayFromIso("2026-10-19")),
    primaryZone: "America/Los_Angeles",
    selection: Option.some("fixture-selection"),
  });

const waitFor = (
  actor: EditorActor,
  predicate: (snapshot: ReturnType<EditorActor["getSnapshot"]>) => boolean
) =>
  snapshots(actor).pipe(
    Stream.filter(
      (snapshot) => snapshot.status === "error" || predicate(snapshot)
    ),
    Stream.runHead,
    Effect.flatMap((snapshot) => Effect.fromOption(snapshot)),
    Effect.filterOrElse(
      (snapshot) => snapshot.status !== "error",
      (snapshot) => Effect.die(snapshot.error)
    )
  );

const act = (actor: EditorActor, action: typeof EditorAction.Type) =>
  send(actor, { action, type: "ACTION" });

const observeAction = Effect.fn("observeEditorAction")(function* observeAction(
  actor: EditorActor,
  action: typeof EditorAction.Type
) {
  const queue =
    yield* Queue.unbounded<ReturnType<EditorActor["getSnapshot"]>>();

  return yield* Effect.acquireUseRelease(
    Effect.sync(() =>
      actor.subscribe((snapshot) => {
        Queue.offerUnsafe(queue, snapshot);
      })
    ),
    () => act(actor, action).pipe(Effect.andThen(Queue.take(queue))),
    (subscription) =>
      Effect.sync(() => {
        subscription.unsubscribe();
      })
  );
});

const harness = Effect.fn("editorMachineHarness")(
  function* editorMachineHarness(
    refuse?: boolean | MutationFailureValue,
    original: CalendarEventValue = editorOriginal
  ) {
    const created: (typeof CreateEventInput.Type)[] = [];
    const updated: (typeof UpdateEventInput.Type)[] = [];
    const deleted: string[] = [];

    const master = {
      ...original,
      end: { dateTime: "2026-09-21T10:00:00-07:00" },
      eventId: "fixture-series",
      recurrence: editorDraft.repeat.rules,
      recurringEventId: undefined,
      start: { dateTime: "2026-09-21T09:00:00-07:00" },
    };

    const rejection = new Provider({
      message: "Fixture refused update",
      operation: "updateEvent",
      status: 403,
    });

    const client = CalendarEditingClient.of({
      createEvent: (input) =>
        Effect.sync(() => {
          created.push(input);

          return { ...original, ...input.event, eventId: input.id };
        }),
      deleteEvent: () => Effect.void,
      getEvent: (ref) =>
        Effect.succeed(ref.eventId === master.eventId ? master : original),
      moveAndRetimeSeries: () => Effect.die("Unexpected series operation"),
      moveEvent: () => Effect.succeed(original),
      moveSupport: "notAvailable",
      rsvp: () => Effect.succeed(original),
      updateEvent: (input) =>
        Effect.gen(function* updateFixtureEvent() {
          updated.push(input);

          if (Schema.is(MutationFailure)(refuse)) {
            return yield* refuse;
          }

          return yield* refuse === true
            ? Effect.fail(rejection)
            : Effect.succeed({ ...original, ...input.changes });
        }),
    });

    const deletion = yield* DeletionSession.make().pipe(
      Effect.provideService(
        DeletionWriter,
        DeletionWriter.of({
          commit: (input) =>
            Effect.sync(() => {
              deleted.push(input.request.eventId);
            }),
        })
      )
    );

    const crypto = yield* Crypto.Crypto;

    const actor = yield* createEffectActor(eventEditorMachine).pipe(
      Effect.provideService(CalendarEditingClient, client),
      Effect.provideService(DeletionSession, deletion),
      Effect.provideService(Crypto.Crypto, crypto)
    );

    yield* watchActor("calendar.editor.test", actor);

    return { actor, created, deleted, rejection, updated };
  }
);

it.effect(
  "a new unsaved event creates no Google write, including after cancellation",
  () =>
    Effect.gen(function* discardNewEvent() {
      const h = yield* harness();
      yield* send(h.actor, {
        request: EditorRequest.cases.New.make({
          allDay: false,
          calendars: editorCalendars,
          endDate: "2026-10-19",
          endTime: "10:00",
          navigation: initialNavigation(dayFromIso("2026-10-19")),
          primaryZone: "America/Los_Angeles",
          ref: { accountId: "work", calendarId: "primary" },
          selection: Option.none(),
          startDate: "2026-10-19",
          startTime: "09:30",
        }),
        type: "OPEN",
      });

      const opened = yield* waitFor(h.actor, (snapshot) =>
        snapshot.matches("editing")
      );

      expect(projectEditor(opened)._tag).toBe("Editing");
      yield* act(
        h.actor,
        EditorAction.cases.TextEdited.make({
          field: "title",
          value: "Unsaved title",
        })
      );
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("editing"));
      yield* act(h.actor, EditorAction.cases.Cancel.make({}));
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("closed"));
      expect(h.created).toHaveLength(0);
      expect(h.updated).toHaveLength(0);
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "meeting changes wait for the selected repeat scope and an explicit email decision",
  () =>
    Effect.gen(function* scopeThenEmail() {
      const h = yield* harness();
      yield* send(h.actor, { request: existingRequest(), type: "OPEN" });
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("editing"));
      yield* act(
        h.actor,
        EditorAction.cases.TextEdited.make({
          field: "title",
          value: "Updated meeting",
        })
      );
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("editing"));
      yield* act(h.actor, EditorAction.cases.Save.make({}));
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("scope"));
      expect(h.updated).toHaveLength(0);
      yield* act(
        h.actor,
        EditorAction.cases.ScopeSelected.make({ value: "all" })
      );
      yield* act(h.actor, EditorAction.cases.ConfirmScope.make({}));
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("email"));
      expect(h.updated).toHaveLength(0);
      yield* act(h.actor, EditorAction.cases.SendUpdates.make({ send: false }));
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("closed"));
      expect(h.updated).toHaveLength(1);
      expect(h.updated[0]).toMatchObject({
        changes: { title: "Updated meeting" },
        scope: "all",
        sendUpdates: "none",
      });
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "personal colour changes skip email but still honour the chosen recurring scope",
  () =>
    Effect.gen(function* personalChange() {
      const h = yield* harness();
      yield* send(h.actor, { request: existingRequest(), type: "OPEN" });
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("editing"));
      yield* act(
        h.actor,
        EditorAction.cases.ColorSelected.make({ value: "7" })
      );
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("editing"));
      yield* act(h.actor, EditorAction.cases.Save.make({}));
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("scope"));
      yield* act(h.actor, EditorAction.cases.ConfirmScope.make({}));
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("closed"));
      expect(h.updated[0]).toMatchObject({
        changes: { colorId: "7" },
        scope: "single",
        sendUpdates: "none",
      });
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "typed provider rejection remains a failed editor with the user's draft intact",
  () =>
    Effect.gen(function* rejectedSave() {
      const h = yield* harness(true);
      yield* send(h.actor, { request: existingRequest(), type: "OPEN" });
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("editing"));
      yield* act(
        h.actor,
        EditorAction.cases.ColorSelected.make({ value: "7" })
      );
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("editing"));
      yield* act(h.actor, EditorAction.cases.Save.make({}));
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("scope"));
      yield* act(h.actor, EditorAction.cases.ConfirmScope.make({}));

      const failed = yield* waitFor(h.actor, (snapshot) =>
        snapshot.matches("failed")
      );

      const projected = projectEditor(failed);
      expect(EditorView.guards.Failure(projected)).toBe(true);
      expect(failed.context.session?.draft.colorId).toBe("7");
      expect(failed.context.failure).toEqual(h.rejection);
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "All-events time editing retains the selected instance reference rather than patching the master with its later date",
  () =>
    Effect.gen(function* selectedInstanceTimeScope() {
      const h = yield* harness();
      yield* send(h.actor, { request: existingRequest(), type: "OPEN" });
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("editing"));
      yield* act(
        h.actor,
        EditorAction.cases.TextEdited.make({
          field: "startTime",
          value: "10:00",
        })
      );
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("editing"));
      yield* act(
        h.actor,
        EditorAction.cases.TextEdited.make({ field: "endTime", value: "11:00" })
      );
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("editing"));
      yield* act(h.actor, EditorAction.cases.Save.make({}));
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("scope"));
      yield* act(
        h.actor,
        EditorAction.cases.ScopeSelected.make({ value: "all" })
      );
      yield* act(h.actor, EditorAction.cases.ConfirmScope.make({}));
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("email"));
      yield* act(h.actor, EditorAction.cases.SendUpdates.make({ send: false }));
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("closed"));
      expect(h.updated[0]).toMatchObject({
        changes: {
          end: { dateTime: "2026-10-19T18:00:00.000Z" },
          start: { dateTime: "2026-10-19T17:00:00.000Z" },
        },
        eventId: editorOriginal.eventId,
        scope: "all",
      });
      expect(h.updated[0]?.eventId).not.toBe("fixture-series");
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "E then A flips the loaded draft without writing, and cancellation discards it while confirmation writes once",
  () =>
    Effect.gen(function* keyboardAllDayOpening() {
      const h = yield* harness();

      const commandArgs = Schema.Struct({
        command: EditingCommand,
        personId: Schema.String,
      });

      for (const confirm of [false, true]) {
        const base = keyboardFixture();

        const prefix = update(
          base,
          Message.PressedCalendarKey({
            alt: false,
            key: "e",
            mod: false,
            now: 100,
            shift: false,
          })
        ).model;

        const opened = update(
          prefix,
          Message.PressedCalendarKey({
            alt: false,
            key: "a",
            mod: false,
            now: 101,
            shift: false,
          })
        );

        const { command } = yield* Schema.decodeUnknownEffect(commandArgs)(
          opened.commands?.[0]?.args
        );

        expect(EditingCommand.guards.Open(command)).toBe(true);

        if (!EditingCommand.guards.Open(command)) {
          return yield* Effect.die(
            new Error("keyboard did not open an editor")
          );
        }

        yield* send(h.actor, { request: command.request, type: "OPEN" });

        const loaded = yield* waitFor(h.actor, (snapshot) =>
          snapshot.matches("editing")
        );

        const projected = projectEditor(loaded);

        const ready = update(
          opened.model,
          Message.ReceivedEditing({
            notice: EditingNotice.cases.Editor.make({
              error: Option.none(),
              mutation: Option.none(),
              plan: Option.none(),
              saving: false,
              view: projected,
            }),
            personId: "fixture-person",
          })
        );

        const { command: toggle } = yield* Schema.decodeUnknownEffect(
          commandArgs
        )(ready.commands?.[0]?.args);

        expect(EditingCommand.guards.Action(toggle)).toBe(true);

        if (!EditingCommand.guards.Action(toggle)) {
          return yield* Effect.die(
            new Error("loaded keyboard editor did not queue the toggle")
          );
        }

        expect(EditorAction.guards.ToggleAllDay(toggle.action)).toBe(true);
        const wasAllDay = loaded.context.session?.draft.allDay === true;
        yield* act(h.actor, toggle.action);

        const toggled = yield* waitFor(
          h.actor,
          (snapshot) =>
            snapshot.matches("editing") &&
            snapshot.context.session?.draft.allDay === !wasAllDay
        );

        expect(toggled.context.session?.draft.allDay).toBe(!wasAllDay);
        expect(h.updated).toHaveLength(0);
        expect(h.created).toHaveLength(0);
        expect(h.deleted).toHaveLength(0);

        if (confirm) {
          yield* act(h.actor, EditorAction.cases.Save.make({}));
          yield* waitFor(h.actor, (snapshot) => snapshot.matches("scope"));
          expect(h.updated).toHaveLength(0);
          yield* act(h.actor, EditorAction.cases.ConfirmScope.make({}));
          yield* waitFor(h.actor, (snapshot) => snapshot.matches("email"));
          expect(h.updated).toHaveLength(0);
          yield* act(
            h.actor,
            EditorAction.cases.SendUpdates.make({ send: false })
          );
          yield* waitFor(h.actor, (snapshot) => snapshot.matches("closed"));
          expect(h.updated).toHaveLength(1);
        } else {
          yield* act(h.actor, EditorAction.cases.Cancel.make({}));
          yield* waitFor(h.actor, (snapshot) => snapshot.matches("closed"));
          expect(h.updated).toHaveLength(0);
        }
      }

      return yield* Effect.void;
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect.each(["partial", "uncertain"])(
  "a %s write outcome rejects Save and Retry until the recovery view is closed",
  (kind) =>
    Effect.gen(function* nonReplayableOutcome() {
      const cause = new Provider({
        message: "Fixture outcome",
        operation: "moveEvent",
        status: kind === "partial" ? 403 : 503,
      });

      const failure =
        kind === "partial"
          ? new SeriesMoveRetimePartial({
              cause,
              changes: {
                end: { dateTime: "2026-10-19T18:00:00Z" },
                start: { dateTime: "2026-10-19T17:00:00Z" },
              },
              completedStep: "move",
              movedEvent: {
                ...editorOriginal,
                calendarId: "team",
                eventId: "moved-master",
              },
              retimeOutcome: "rejected",
            })
          : new SeriesMoveRetimeUncertain({
              cause,
              destination: { accountId: "work", calendarId: "team" },
              source: editorOriginal,
            });

      const h = yield* harness(failure);
      yield* send(h.actor, { request: existingRequest(), type: "OPEN" });
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("editing"));
      yield* act(
        h.actor,
        EditorAction.cases.ColorSelected.make({ value: "7" })
      );
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("editing"));
      yield* act(h.actor, EditorAction.cases.Save.make({}));
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("scope"));
      yield* act(h.actor, EditorAction.cases.ConfirmScope.make({}));
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("failed"));
      expect(h.updated).toHaveLength(1);

      for (const action of [
        EditorAction.cases.Retry.make({}),
        EditorAction.cases.Save.make({}),
      ]) {
        const snapshot = yield* observeAction(h.actor, action);
        expect(snapshot.matches("failed")).toBe(true);
        expect(h.updated).toHaveLength(1);
      }

      yield* act(h.actor, EditorAction.cases.Cancel.make({}));
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("closed"));
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "a dropped move enters the existing scope and email decisions before any write",
  () =>
    Effect.gen(function* droppedMoveConfirmation() {
      const h = yield* harness();

      const request = EditorRequest.cases.Existing.make({
        ...existingRequest(),
        range: {
          allDay: false,
          endDate: "2026-10-19",
          endTime: "11:00",
          startDate: "2026-10-19",
          startTime: "10:00",
        },
      });

      yield* send(h.actor, { request, type: "OPEN" });
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("scope"));
      expect(h.updated).toHaveLength(0);
      yield* act(h.actor, EditorAction.cases.ConfirmScope.make({}));
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("email"));
      expect(h.updated).toHaveLength(0);
      yield* act(h.actor, EditorAction.cases.SendUpdates.make({ send: false }));
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("closed"));
      expect(h.updated).toHaveLength(1);
      expect(h.updated[0]).toMatchObject({
        changes: { start: { dateTime: "2026-10-19T17:00:00.000Z" } },
        eventId: editorOriginal.eventId,
        scope: "single",
        sendUpdates: "none",
      });
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect.prop(
  "conferencing replacement requires confirmation and still passes through scope and email without changing event times",
  {
    confirm: Schema.Boolean,
    native: Schema.Boolean,
    title: Schema.String,
  },
  ({ confirm, native, title }) =>
    Effect.gen(function* conferencingConfirmationHistory() {
      const original = {
        ...editorOriginal,
        conferenceUrl: native
          ? "https://meet.google.com/abc-defg-hij"
          : undefined,
        location: native
          ? "Studio"
          : "Studio https://zoom.us/j/123; north door",
        title,
      };

      const h = yield* harness(undefined, original);

      const request = {
        ...existingRequest(),
        calendars: editorCalendars.map((calendar) => ({
          ...calendar,
          allowedConferenceSolutionTypes: ["hangoutsMeet"],
        })),
      };

      yield* send(h.actor, { request, type: "OPEN" });

      const before = projectEditor(
        yield* waitFor(h.actor, (snapshot) => snapshot.matches("editing"))
      );

      expect(EditorView.guards.Editing(before)).toBe(true);

      const pending = projectEditor(
        yield* observeAction(h.actor, EditorAction.cases.AddMeet.make({}))
      );

      expect(pending._tag).toBe("ConfirmConferencing");

      const ignoredSave = yield* observeAction(
        h.actor,
        EditorAction.cases.Save.make({})
      );

      expect(projectEditor(ignoredSave)._tag).toBe("ConfirmConferencing");
      expect(h.updated).toHaveLength(0);
      expect(h.created).toHaveLength(0);

      if (!confirm) {
        yield* act(h.actor, EditorAction.cases.Cancel.make({}));

        const cancelled = projectEditor(
          yield* waitFor(h.actor, (snapshot) => snapshot.matches("editing"))
        );

        expect(cancelled).toEqual(before);

        const ignoredConfirm = yield* observeAction(
          h.actor,
          EditorAction.cases.ConfirmConferencing.make({})
        );

        expect(projectEditor(ignoredConfirm)).toEqual(before);
        expect(h.updated).toHaveLength(0);

        return;
      }

      yield* act(h.actor, EditorAction.cases.ConfirmConferencing.make({}));
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("editing"));
      yield* act(h.actor, EditorAction.cases.Save.make({}));
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("scope"));
      expect(h.updated).toHaveLength(0);
      yield* act(h.actor, EditorAction.cases.ConfirmScope.make({}));
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("email"));
      expect(h.updated).toHaveLength(0);
      yield* act(h.actor, EditorAction.cases.SendUpdates.make({ send: false }));
      yield* waitFor(h.actor, (snapshot) => snapshot.matches("closed"));
      expect(h.updated).toHaveLength(1);
      expect(h.updated[0]).toMatchObject({
        conferencingRequest: { kind: "googleMeet" },
        sendUpdates: "none",
      });
      expect(h.updated[0]?.changes.start).toBeUndefined();
      expect(h.updated[0]?.changes.end).toBeUndefined();
      expect(h.updated[0]?.changes.title).toBeUndefined();
      expect(h.created).toHaveLength(0);
    }).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 20 } }
);

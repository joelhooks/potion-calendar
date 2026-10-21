import { expect, it } from "@effect/vitest";
import { Effect, Option, Ref, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { EditorRequest } from "../src/client/editing/editor-session-model.js";
import { EditingCommand } from "../src/client/editing/runtime.js";
import { keyboardRegistry } from "../src/client/keyboard/registry.js";
import { keyboardFixture } from "./keyboard-fixture.js";
import { offlineKeyboardFixture } from "./keyboard-offline-create-fixture.js";

it.effect.each(["MacIntel", "Win32"])(
  "offline native C is silent and emits no creation command on %s",
  (system) =>
    Effect.gen(function* offlineCreation() {
      const fixture = yield* offlineKeyboardFixture();
      fixture.platform.mockReturnValue(system);
      fixture.online.mockReturnValue(false);
      const before = yield* Ref.get(fixture.state);

      expect(Option.isSome(before.person)).toBe(true);
      expect(EditorView.guards.Closed(before.editing.view)).toBe(true);
      expect(
        before.calendar.calendars.some(
          (calendar) => calendar.accessRole === "owner"
        )
      ).toBe(true);

      const result = yield* fixture.press({ key: "c" });
      expect(Option.isNone(result.message)).toBe(true);
      expect(result.event.defaultPrevented).toBe(false);
      expect(result.result.model).toBe(before);
      expect(result.result.commands ?? []).toEqual([]);
      expect(yield* Ref.get(fixture.dispatched)).toEqual([]);
    }).pipe(Effect.scoped)
);

it.effect.each(["MacIntel", "Win32"])(
  "online native C reaches the existing person-scoped creation command on %s",
  (system) =>
    Effect.gen(function* onlineCreation() {
      const fixture = yield* offlineKeyboardFixture();
      fixture.platform.mockReturnValue(system);
      const result = yield* fixture.press({ key: "c" });
      const calls = yield* Ref.get(fixture.dispatched);

      expect(result.event.defaultPrevented).toBe(true);
      expect(result.result.commands?.map((command) => command.name)).toEqual([
        "DispatchEditing",
      ]);
      expect(calls).toHaveLength(1);
      const call = Option.getOrThrow(Option.fromUndefinedOr(calls[0]));
      expect(call.personId).toBe(Option.getOrThrow(result.before.person));

      if (!EditingCommand.guards.Open(call.command)) {
        return yield* Effect.die("Expected the existing editor Open command");
      }

      const { request } = call.command;

      if (!EditorRequest.guards.New(request)) {
        return yield* Effect.die("Expected an ordinary New request");
      }

      expect(request.ref).toEqual({
        accountId: "work",
        calendarId: "primary",
      });
      expect(request.allDay).toBe(false);
      expect(result.result.model.calendar).toBe(result.before.calendar);
      expect(result.result.model.error).toBe(result.before.error);

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "each native C press samples the current browser signal without relaxing calendar permissions",
  {
    changes: Schema.Array(Schema.Boolean).check(Schema.isMaxLength(12)),
    role: Schema.Literals(["owner", "writer", "reader", "freeBusyReader"]),
    signedIn: Schema.Boolean,
  },
  ({ changes, role, signedIn }) =>
    Effect.gen(function* currentSignalHistory() {
      const base = keyboardFixture();

      const initial = {
        ...base,
        calendar: {
          ...base.calendar,
          calendars: base.calendar.calendars.map((calendar) => ({
            ...calendar,
            accessRole: role,
          })),
        },
        person: signedIn ? base.person : Option.none(),
      };

      const fixture = yield* offlineKeyboardFixture(initial);
      let expected = 0;

      for (const online of [true, false, true, false, ...changes]) {
        fixture.online.mockReturnValue(online);
        const result = yield* fixture.press({ key: "c" });

        const eligible =
          online && signedIn && (role === "owner" || role === "writer");

        expected += eligible ? 1 : 0;
        expect(result.event.defaultPrevented).toBe(eligible);
        expect(Option.isSome(result.message)).toBe(eligible);
        expect(yield* Ref.get(fixture.dispatched)).toHaveLength(expected);
        expect(result.result.model.calendar).toBe(initial.calendar);
        expect(result.result.model.error).toBe(initial.error);
      }
    }).pipe(Effect.scoped),
  { arbitrary: { runs: 100 } }
);

it.effect.each([false, true])(
  "C preserves editable-text and dialog ownership when browser online=%s",
  (online) =>
    Effect.gen(function* nativeTextOwnership() {
      const fixture = yield* offlineKeyboardFixture();
      fixture.online.mockReturnValue(online);

      for (const target of [
        fixture.input,
        fixture.textarea,
        fixture.editable,
        fixture.dialog,
      ]) {
        const result = yield* fixture.press({ key: "c" }, target);
        expect(result.event.defaultPrevented).toBe(false);
        expect(Option.isNone(result.message)).toBe(true);
        expect(result.result.model).toBe(result.before);
      }

      expect(fixture.input.value).toBe("Existing title");
      expect(fixture.textarea.value).toBe("Existing description");
      expect(yield* Ref.get(fixture.dispatched)).toEqual([]);
    }).pipe(Effect.scoped)
);

it.effect(
  "offline E then C still opens the selected event's calendar field, not a new event",
  () =>
    Effect.gen(function* offlineCalendarField() {
      const fixture = yield* offlineKeyboardFixture();
      fixture.online.mockReturnValue(false);
      yield* fixture.press({ key: "e" });
      const result = yield* fixture.press({ key: "c" });
      const calls = yield* Ref.get(fixture.dispatched);

      expect(result.event.defaultPrevented).toBe(true);
      expect(result.result.model.keyboard.focus).toBe("event-calendar");
      expect(calls).toHaveLength(1);
      const call = Option.getOrThrow(Option.fromUndefinedOr(calls[0]));
      expect(call.command._tag).toBe("Open");

      if (!EditingCommand.guards.Open(call.command)) {
        return yield* Effect.die("Expected the existing editor Open command");
      }

      expect(call.command.request._tag).toBe("Existing");

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect(
  "offline does not swallow unrelated sidebar keys or platform clipboard chords",
  () =>
    Effect.gen(function* unrelatedOfflineKeys() {
      const fixture = yield* offlineKeyboardFixture();
      fixture.online.mockReturnValue(false);
      const toggled = yield* fixture.press({ ctrlKey: true, key: "\\" });
      expect(toggled.event.defaultPrevented).toBe(true);
      expect(toggled.result.model.keyboard.sidebar).toBe(
        !toggled.before.keyboard.sidebar
      );

      for (const system of ["MacIntel", "Win32"]) {
        fixture.platform.mockReturnValue(system);

        const copied = yield* fixture.press(
          {
            ctrlKey: system === "Win32",
            key: "c",
            metaKey: system === "MacIntel",
          },
          fixture.input
        );

        expect(copied.event.defaultPrevented).toBe(false);
        expect(Option.isNone(copied.message)).toBe(true);
      }

      expect(yield* Ref.get(fixture.dispatched)).toEqual([]);
    }).pipe(Effect.scoped)
);

it.effect(
  "online does not turn repeat or composing C events into creation commands",
  () =>
    Effect.gen(function* ineligibleNativeEvents() {
      const fixture = yield* offlineKeyboardFixture();

      for (const init of [
        { key: "c", repeat: true },
        { isComposing: true, key: "c" },
      ]) {
        const result = yield* fixture.press(init);
        expect(result.event.defaultPrevented).toBe(false);
        expect(Option.isNone(result.message)).toBe(true);
        expect(result.result.model).toBe(result.before);
      }

      expect(yield* Ref.get(fixture.dispatched)).toEqual([]);
    }).pipe(Effect.scoped)
);

it.effect(
  "the command-palette Create action remains available and uses its existing command while offline",
  () =>
    Effect.gen(function* unchangedPaletteCreation() {
      const fixture = yield* offlineKeyboardFixture();
      fixture.online.mockReturnValue(false);
      const model = yield* Ref.get(fixture.state);

      const create = Option.getOrThrow(
        Option.fromUndefinedOr(
          keyboardRegistry.find((action) => action.id === "create")
        )
      );

      expect(create.availability(model)).toBe("enabled");
      const result = update(model, create.dispatch(model));
      expect(result.commands?.map((command) => command.name)).toEqual([
        "DispatchEditing",
      ]);
      expect(result.model.error).toBe(model.error);
      expect(result.model.calendar).toBe(model.calendar);
      expect(
        update(
          {
            ...model,
            keyboard: { ...model.keyboard, screen: "commands" },
          },
          Message.KeyboardPick({ id: "create" })
        ).commands?.map((command) => command.name)
      ).toEqual(["DispatchEditing"]);
    }).pipe(Effect.scoped)
);

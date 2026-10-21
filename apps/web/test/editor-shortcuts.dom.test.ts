import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import {
  Deferred,
  Effect,
  Fiber,
  Option,
  Predicate,
  Schema,
  Stream,
} from "effect";

import type { AppModel } from "../src/client/app.js";
import { PrepareEditingDialogs } from "../src/client/editing/dialog-mount.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { EditingCommand } from "../src/client/editing/runtime.js";
import { keyboardRegistry } from "../src/client/keyboard/registry.js";
import {
  captureShortcutCommands,
  pressEditorShortcut,
  receiveShortcutEditor,
  renderShortcutRoot,
  shortcutFixture,
} from "./editor-shortcut-fixture.js";

const fieldKeys = [
  ["t", "title"],
  ["d", "startDate"],
  ["s", "startTime"],
  ["q", "endTime"],
  ["z", "timeZone"],
  ["j", "add-meet"],
  ["c", "calendar"],
  ["r", "repeat"],
  ["p", "participantEmail"],
  ["l", "location"],
  ["k", "links"],
  ["w", "description"],
  ["h", "reminderInput"],
] as const;

it.effect.each(fieldKeys)(
  "E then %s reaches the existing %s field through the normal root editor command without saving",
  ([key, target]) =>
    Effect.gen(function* fieldRecipient() {
      const result = pressEditorShortcut(
        shortcutFixture("without-conferencing"),
        key
      );

      const commands = yield* captureShortcutCommands(result);
      expect(commands).toHaveLength(1);
      expect(commands[0]?._tag).toBe("Open");
      expect(
        EditingCommand.guards.Open(commands[0]) &&
          Predicate.isTagged(commands[0].request, "Existing")
      ).toBe(true);
      const opened = receiveShortcutEditor(result.model);
      const rendered = yield* renderShortcutRoot(opened);
      const dom = new DOMParser().parseFromString(rendered.html, "text/html");

      const focus = dom.querySelector<HTMLElement>("#event-editor-dialog")
        ?.dataset.initialFocus;

      const control = dom.querySelector(`#${focus ?? "absent"}`);
      expect(opened.keyboard.focus).toBe(`event-${target}`);
      expect(focus).toBe(
        target === "calendar" ? "event-color" : `event-${target}`
      );
      expect(control).not.toBeNull();
      expect(control?.hasAttribute("disabled")).toBe(false);
      expect(
        commands.some((command) => EditingCommand.guards.Action(command))
      ).toBe(false);
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect.prop(
  "E then J is bound only when its existing conferencing control is usable",
  {
    editable: Schema.Boolean,
    supportedType: Schema.Boolean,
    supportsMeet: Schema.Boolean,
    writable: Schema.Boolean,
  },
  ({ writable, editable, supportedType, supportsMeet }) =>
    Effect.gen(function* conferencingEligibility() {
      const fixture = shortcutFixture(
        supportedType ? "without-conferencing" : "unsupported",
        editable
      );

      const model: AppModel = {
        ...fixture,
        calendar: {
          ...fixture.calendar,
          calendars: fixture.calendar.calendars.map((calendar) => ({
            ...calendar,
            accessRole: writable ? "owner" : "reader",
            allowedConferenceSolutionTypes: supportsMeet
              ? ["hangoutsMeet"]
              : [],
          })),
        },
      };

      const row = keyboardRegistry.find(
        (entry) => entry.id === "edit-add-meet"
      );

      expect(row).toBeDefined();
      const permitted = writable && editable && supportedType && supportsMeet;
      expect(row?.availability(model)).toBe(permitted ? "enabled" : "disabled");
      const result = pressEditorShortcut(model, "j");
      const commands = yield* captureShortcutCommands(result);
      expect(commands.filter(EditingCommand.guards.Open)).toHaveLength(
        permitted ? 1 : 0
      );
      expect(EditorView.guards.Closed(result.model.editing.view)).toBe(true);
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect.each(["with-conferencing", "without-conferencing"] as const)(
  "the production dialog mount focuses the conferencing control for %s",
  (scene) =>
    Effect.scoped(
      Effect.gen(function* nativeFocus() {
        const result = pressEditorShortcut(shortcutFixture(scene), "j");
        yield* captureShortcutCommands(result);
        const model = receiveShortcutEditor(result.model);
        const rendered = yield* renderShortcutRoot(model);
        const element = document.createElement("div");
        element.innerHTML = rendered.html;
        document.body.append(element);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            element.remove();
          })
        );

        const dialog = element.querySelector<HTMLDialogElement>(
          "#event-editor-dialog"
        );

        Object.defineProperty(dialog, "showModal", {
          value: () => {
            dialog?.setAttribute("open", "");
          },
        });

        const control = yield* Effect.fromNullishOr(
          element.querySelector<HTMLButtonElement>("#event-add-meet")
        ).pipe(Effect.orDie);

        const focused = yield* Deferred.make<boolean>();
        control.addEventListener(
          "focus",
          () => {
            Deferred.doneUnsafe(focused, Effect.succeed(true));
          },
          { once: true }
        );

        const waiting = yield* Effect.forkChild(
          PrepareEditingDialogs({ person: model.person })
            .f(element, Stream.never)
            .pipe(Stream.runHead)
        );

        yield* Deferred.await(focused);
        expect(document.activeElement).toBe(control);
        expect(control.disabled).toBe(false);
        dialog?.dispatchEvent(
          new Event("cancel", { bubbles: true, cancelable: true })
        );
        expect(Option.getOrThrow(yield* Fiber.join(waiting))._tag).toBe(
          "EditingAction"
        );
      })
    ).pipe(Effect.provide(NodeServices.layer))
);

it.effect("keys without an implemented field or workflow stay unbound", () =>
  Effect.sync(() => {
    expect(keyboardRegistry.find((row) => row.keys.includes("e e"))?.id).toBe(
      "email-participants"
    );

    for (const key of ["e u", "e f"]) {
      expect(keyboardRegistry.some((row) => row.keys.includes(key))).toBe(
        false
      );
    }

    const model = shortcutFixture("unsupported");

    for (const key of ["p", "l", "w", "k"]) {
      expect(pressEditorShortcut(model, key).commands ?? []).toHaveLength(0);
    }
  })
);

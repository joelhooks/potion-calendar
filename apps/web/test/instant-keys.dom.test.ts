import { expect, it } from "@effect/vitest";
import { Effect, Option, Predicate, Schema } from "effect";
import type { HtmlBuilder } from "foldkit/html";
import { Scene } from "foldkit/test";

import type { AppModel } from "../src/client/app.js";
import { Message, update } from "../src/client/app.js";
import { RemoteEvents, eventKey } from "../src/client/calendar-state.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { EditingCommand } from "../src/client/editing/runtime.js";
import { keyboardMessage } from "../src/client/keyboard/input.js";
import { keyboardRegistry } from "../src/client/keyboard/registry.js";
import { editorDialog } from "../src/features/editor-dialog.js";
import { editingFixture } from "./editor-fixture.js";
import { fixtureModel, fixtureEvents } from "./fixture.js";

const instantKeyModel = (writable: boolean, ordinary: boolean): AppModel => {
  const base = fixtureModel();
  const [first] = fixtureEvents;

  if (first === undefined) {
    throw new Error("Missing saved fixture event");
  }

  const source = {
    ...first,
    calendarId: "shared",
    eventType: ordinary ? ("default" as const) : ("outOfOffice" as const),
  };

  return {
    ...base,
    calendar: {
      ...base.calendar,
      calendars: base.calendar.calendars
        .filter(
          (calendar) =>
            calendar.accountId === "work" && calendar.calendarId === "primary"
        )
        .map((calendar) => ({
          ...calendar,
          accessRole: writable ? "writer" : "reader",
          calendarId: "shared",
          primary: false,
          title: "Shared planning",
        })),
      hidden: [],
      mergeDuplicates: false,
      reads: [
        {
          accountId: "work",
          events: RemoteEvents.Success({
            data: { events: [source], versions: [] },
          }),
        },
      ],
      selected: [eventKey(source)],
    },
  };
};

const nativeMessage = (
  model: AppModel,
  key: string,
  platform: "MacIntel" | "Win32",
  target: HTMLElement
) => {
  let result = Option.none<ReturnType<typeof Message.PressedCalendarKey>>();

  const listener = (event: KeyboardEvent) => {
    const message = keyboardMessage(model, event, model.calendar.now, platform);

    if (
      Option.isSome(message) &&
      Predicate.isTagged(message.value, "PressedCalendarKey")
    ) {
      result = Option.some(message.value);
    }
  };

  target.addEventListener("keydown", listener, { once: true });
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: platform === "Win32",
      key,
      metaKey: platform === "MacIntel",
      shiftKey: true,
    })
  );

  return result;
};

it.effect.prop(
  "native instant-delete aliases grant no write permission and refuse read-only or out-of-office sources without a notice",
  {
    alias: Schema.Literals(["Delete", "Backspace", "Del"]),
    ordinary: Schema.Boolean,
    platform: Schema.Literals(["MacIntel", "Win32"]),
    writable: Schema.Boolean,
  },
  ({ writable, ordinary, alias, platform }) =>
    Effect.gen(function* instantPermissions() {
      const model = instantKeyModel(writable, ordinary);
      const target = document.createElement("button");
      const message = nativeMessage(model, alias, platform, target);
      const enabled = writable && ordinary;
      expect(Option.isSome(message)).toBe(enabled);
      expect(
        keyboardRegistry
          .find((row) => row.id === "delete-no-email")
          ?.availability(model)
      ).toBe(enabled ? "enabled" : "disabled");

      if (Option.isSome(message)) {
        const result = update(model, message.value);

        const command = result.commands?.find(
          (item) => item.name === "DispatchEditing"
        );

        const args = yield* Schema.decodeUnknownEffect(
          Schema.Struct({ command: EditingCommand, personId: Schema.String })
        )(command?.args);

        expect(
          EditingCommand.guards.Open(args.command) &&
            args.command.request.intent === "noEmailOccurrence"
        ).toBe(true);
      } else {
        const result = update(
          model,
          Message.EditingAction({
            action: EditorAction.cases.DeleteNoEmail.make({}),
          })
        );

        expect(result.model).toBe(model);
        expect(result.commands).toBeUndefined();
      }

      expect(model.error).toEqual(Option.none());
    })
);

it.effect(
  "Shift-Mod-Return reaches the pending editor from a textarea but not ordinary text selection or unsupported editor sources",
  () =>
    Effect.gen(function* nativeEditorInstant() {
      const base = instantKeyModel(true, true);
      const textarea = document.createElement("textarea");

      const model = {
        ...base,
        editing: {
          ...base.editing,
          view: {
            ...editingFixture,
            original: Option.some({
              ...Option.getOrThrow(editingFixture.original),
              eventType: "default" as const,
            }),
          },
        },
      };

      for (const platform of ["MacIntel", "Win32"] as const) {
        const message = nativeMessage(model, "Enter", platform, textarea);
        expect(Option.isSome(message)).toBe(true);

        if (Option.isSome(message)) {
          const result = update(model, message.value);

          const args = yield* Schema.decodeUnknownEffect(
            Schema.Struct({ command: EditingCommand, personId: Schema.String })
          )(
            result.commands?.find(
              (command) => command.name === "DispatchEditing"
            )?.args
          );

          expect(
            EditingCommand.guards.Action(args.command) &&
              EditorAction.guards.SaveNoEmail(args.command.action)
          ).toBe(true);
        }

        expect(nativeMessage(base, "Enter", platform, textarea)).toEqual(
          Option.none()
        );
        expect(nativeMessage(model, "Delete", platform, textarea)).toEqual(
          Option.none()
        );

        const unavailable = {
          ...model,
          editing: {
            ...model.editing,
            view: {
              ...model.editing.view,
              permissions: {
                ...model.editing.view.permissions,
                editMeeting: false,
              },
            },
          },
        };

        expect(nativeMessage(unavailable, "Enter", platform, textarea)).toEqual(
          Option.none()
        );
      }
    })
);

it.effect(
  "a series master without a selected occurrence cannot be an instant deletion target",
  () =>
    Effect.sync(() => {
      const base = instantKeyModel(true, true);
      const [first] = fixtureEvents;

      if (first === undefined) {
        throw new Error("Missing source fixture");
      }

      const source = {
        ...first,
        calendarId: "shared",
        eventId: "series-master",
        recurrence: ["RRULE:FREQ=DAILY"],
      };

      const model = {
        ...base,
        calendar: {
          ...base.calendar,
          reads: [
            {
              accountId: "work",
              events: RemoteEvents.Success({
                data: { events: [source], versions: [] },
              }),
            },
          ],
          selected: [eventKey(source)],
        },
      };

      expect(
        nativeMessage(
          model,
          "Delete",
          "Win32",
          document.createElement("button")
        )
      ).toEqual(Option.none());
      expect(
        keyboardRegistry
          .find((row) => row.id === "delete-no-email")
          ?.availability(model)
      ).toBe("disabled");
    })
);

const dialogView = (model: string, h: HtmlBuilder<typeof EditorAction.Type>) =>
  editorDialog(h, {
    body: [h.p([h.Id("dialog-status")], [model])],
    confirm: EditorAction.cases.Save.make({}),
    confirmLabel: "Save",
    id: "instant-dialog-test",
    initialFocus: "",
    label: "Test editor",
    send: (action) => action,
  });

interface DialogUpdateResult {
  readonly model: string;
}

const dialogUpdate = (
  _model: string,
  action: typeof EditorAction.Type
): DialogUpdateResult => ({
  model: action._tag,
});

it.effect(
  "the existing dialog does not consume Shift-Mod-Return as its ordinary Save before the global instant binding",
  () =>
    Effect.sync(() => {
      Scene.scene(
        { update: dialogUpdate, view: dialogView },
        Scene.given("none"),
        Scene.keydown(Scene.selector("dialog"), "Enter", {
          ctrlKey: true,
          shiftKey: true,
        }),
        Scene.expectIgnored(),
        Scene.expect(Scene.selector("#dialog-status")).toHaveText("none"),
        Scene.keydown(Scene.selector("dialog"), "Enter", { ctrlKey: true }),
        Scene.expect(Scene.selector("#dialog-status")).toHaveText("Save")
      );
    })
);

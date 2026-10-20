import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Option, Stream } from "effect";
import { Scene } from "foldkit/test";

import { Message, update } from "../src/client/app.js";
import { DispatchEditing } from "../src/client/editing/commands.js";
import { PrepareEditingDialogs } from "../src/client/editing/dialog-mount.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { PrepareGestures } from "../src/client/editing/gesture-mount.js";
import {
  EditingCommand,
  EditingNotice,
  EditingRuntime,
} from "../src/client/editing/runtime.js";
import { completeGesture } from "../src/client/editing/update.js";
import { eventZoneChoices } from "../src/client/editing/zone-choices.js";
import { PrepareTimeGrid } from "../src/client/grid-mount.js";
import { PrepareKeyboard } from "../src/client/keyboard/mount.js";
import { keyboardRegistry } from "../src/client/keyboard/registry.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import { view } from "../src/features/app.js";
import { zoneCatalog } from "../src/layout/time-zones-display.js";
import { unusedClipboardLayer } from "./clipboard-unused-fixture.js";
import { editorViewFields } from "./editor-fixture.js";
import {
  eventZoneUiFixture,
  renderEventZoneUi,
} from "./event-zone-ui-fixture.js";
import { unexpectedSearchClient } from "./search-fixture.js";

const notice = (timeZone: string) =>
  Message.ReceivedEditing({
    notice: EditingNotice.cases.Editor.make({
      error: Option.none(),
      mutation: Option.none(),
      plan: Option.none(),
      saving: false,
      view: EditorView.cases.Editing.make({
        ...editorViewFields,
        draft: { ...editorViewFields.draft, timeZone },
      }),
    }),
    personId: "fixture-person",
  });

it.effect(
  "E then Z opens the actual editor at the event-only zone chooser and selection dispatches only the temporal action",
  () =>
    Effect.sync(() => {
      const base = eventZoneUiFixture();

      const closed = {
        ...base,
        editing: { ...base.editing, view: EditorView.cases.Closed.make({}) },
      };

      Scene.scene(
        { update, view },
        Scene.given(closed),
        Scene.Mount.resolve(PrepareKeyboard, Message.KeyboardClose()),
        Scene.Mount.resolve(
          PrepareTimeGrid,
          Message.MeasuredViewport({ gutter: 0, height: 844, width: 1220 })
        ),
        Scene.Mount.resolve(
          PrepareGestures,
          Message.PreviewedGesture({
            personId: "fixture-person",
            preview: Option.none(),
          })
        ),
        Scene.Mount.resolve(
          PrepareEditingDialogs,
          Message.EditingAction({
            action: EditorAction.cases.Cancel.make({}),
            personId: "fixture-person",
          })
        ),
        Scene.Command.resolve(DispatchEditing, Message.DispatchedEditing()),
        Scene.Subscription.emit(
          Message.PressedCalendarKey({
            alt: false,
            key: "e",
            mod: false,
            now: 100,
            shift: false,
          })
        ),
        Scene.Subscription.emit(
          Message.PressedCalendarKey({
            alt: false,
            key: "z",
            mod: false,
            now: 200,
            shift: false,
          })
        ),
        Scene.Command.expectHas(DispatchEditing),
        Scene.Command.resolve(DispatchEditing, Message.DispatchedEditing()),
        Scene.Subscription.emit(notice("America/Los_Angeles")),
        Scene.Mount.expectEnded(PrepareGestures),
        Scene.expect(Scene.selector("#event-editor-dialog")).toHaveAttr(
          "data-initial-focus",
          "event-timeZone"
        ),
        Scene.click(Scene.selector("#event-timeZone")),
        Scene.expect(
          Scene.role("dialog", { name: "Event time zone" })
        ).toExist(),
        Scene.expect(
          Scene.selector("[data-command-trigger-hint]")
        ).toBeAbsent(),
        Scene.type(Scene.selector("#keyboard-query"), "Tokyo"),
        Scene.expect(Scene.selector("[id='command-Asia/Tokyo']")).toExist(),
        Scene.keydown(Scene.selector("#keyboard-command-dialog"), "Enter"),
        Scene.Command.expectExact(
          DispatchEditing({
            command: EditingCommand.cases.Action.make({
              action: EditorAction.cases.TimeZoneSelected.make({
                value: "Asia/Tokyo",
              }),
            }),
            personId: "fixture-person",
          })
        ),
        Scene.Command.resolve(DispatchEditing, Message.DispatchedEditing()),
        Scene.Subscription.emit(notice("Asia/Tokyo")),
        Scene.expect(Scene.selector("#keyboard-command-dialog")).toBeAbsent(),
        Scene.expect(Scene.selector("#event-timeZone")).toHaveText(
          "Tokyo · GMT+09:00"
        ),
        Scene.expect(Scene.selector("#event-startTime")).toHaveValue("9am"),
        Scene.expect(Scene.selector("#event-zone-explanation")).toContainText(
          "5pm on the previous day in your primary zone (America/Los_Angeles)"
        )
      );
    })
);

it.effect("the real editor dialog mount focuses the event zone button", () =>
  Effect.gen(function* zoneFocus() {
    const base = eventZoneUiFixture();
    const rendered = yield* renderEventZoneUi(base);
    const element = document.createElement("div");
    element.innerHTML = rendered.html;
    document.body.append(element);
    const ready = yield* Deferred.make<boolean>();

    const dialog = element.querySelector<HTMLDialogElement>(
      "#event-editor-dialog"
    );

    Object.defineProperty(dialog, "showModal", {
      value: () => {
        dialog?.setAttribute("open", "");
      },
    });

    const button = yield* Effect.fromOption(
      Option.fromNullishOr(
        element.querySelector<HTMLButtonElement>("#event-timeZone")
      )
    );

    button.addEventListener(
      "focus",
      () => {
        Deferred.doneUnsafe(ready, Effect.succeed(true));
      },
      { once: true }
    );
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        element.remove();
      })
    );

    const waiting = yield* Effect.forkChild(
      PrepareEditingDialogs({ person: base.person })
        .f(element, Stream.never)
        .pipe(Stream.runHead)
    );

    yield* Deferred.await(ready);
    expect(document.activeElement?.id).toBe("event-timeZone");
    element
      .querySelector("#event-editor-dialog")
      ?.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true }));
    const cancelled = yield* Fiber.join(waiting);
    expect(Option.getOrThrow(cancelled)._tag).toBe("EditingAction");
  })
);

it.effect.each(["allDay", "readonly", "saving"] as const)(
  "%s editors cannot choose a zone",
  (kind) =>
    Effect.gen(function* unavailableZone() {
      const base = eventZoneUiFixture();

      const fields = {
        ...editorViewFields,
        draft: { ...editorViewFields.draft, allDay: kind === "allDay" },
        permissions: {
          ...editorViewFields.permissions,
          editMeeting: kind !== "readonly",
        },
      };

      const model = {
        ...base,
        editing: {
          ...base.editing,
          view:
            kind === "saving"
              ? EditorView.cases.Saving.make(fields)
              : EditorView.cases.Editing.make(fields),
        },
      };

      expect(eventZoneChoices(model)).toEqual([]);
      const rendered = yield* renderEventZoneUi(model);
      const dom = new DOMParser().parseFromString(rendered.html, "text/html");
      const button = dom.querySelector<HTMLButtonElement>("#event-timeZone");

      if (kind === "allDay") {
        expect(button).toBeNull();
        expect(dom.querySelector("#event-zone-explanation")).toBeNull();
      } else {
        expect(button?.disabled).toBe(true);
      }
    })
);

it.effect(
  "the shared catalog contains UTC and no duplicate canonical IDs, with no event-only fallback list",
  () =>
    Effect.sync(() => {
      const ids = zoneCatalog().map((zone) => zone.id);
      expect(ids).toContain("UTC");
      expect(new Set(ids).size).toBe(ids.length);
      const base = eventZoneUiFixture();
      expect(eventZoneChoices(base).map((choice) => choice.id)).toEqual(ids);

      const utc = eventZoneChoices({
        ...base,
        keyboard: { ...base.keyboard, query: "UTC" },
      });

      expect(utc.some((choice) => choice.id === "UTC")).toBe(true);

      const row = keyboardRegistry.find(
        (action) => action.id === "edit-timeZone"
      );

      expect(row?.keys).toEqual(["e z"]);
      expect(
        row?.availability({
          ...base,
          editing: { ...base.editing, view: EditorView.cases.Closed.make({}) },
        })
      ).toBe("enabled");
    })
);

const capturedOpen = Effect.fn("test.capturedEditorOpen")(
  function* capturedOpen(result: ReturnType<typeof update>) {
    const captured: (typeof EditingCommand.Type)[] = [];

    const runtime = EditingRuntime.of({
      connect: () => Effect.die("Unexpected editor connection"),
      dispatch: (_person, command) =>
        Effect.sync(() => {
          captured.push(command);
        }),
    });

    for (const command of result.commands ?? []) {
      yield* command.effect.pipe(
        Effect.provide(unusedClipboardLayer),
        Effect.provideService(EditingRuntime, runtime),
        Effect.provideService(CalendarSearchClient, unexpectedSearchClient)
      );
    }

    return yield* Effect.fromOption(
      Option.fromNullishOr(captured.find(EditingCommand.guards.Open))
    ).pipe(Effect.map((command) => command.request));
  }
);

it.effect(
  "ordinary creation uses home clock/default while an explicit grid drag carries a separate active coordinate zone",
  () =>
    Effect.gen(function* callerZones() {
      const opened = eventZoneUiFixture();

      const base = {
        ...opened,
        editing: { ...opened.editing, view: EditorView.cases.Closed.make({}) },
      };

      const ordinary = yield* capturedOpen(
        update(
          base,
          Message.EditingAction({
            action: EditorAction.cases.OpenCreate.make({}),
            personId: "fixture-person",
          })
        )
      );

      expect(ordinary._tag).toBe("New");
      expect(ordinary).toMatchObject({
        primaryZone: "America/Los_Angeles",
        startDate: "2026-10-21",
        startTime: "10:30",
      });

      const existing = yield* capturedOpen(
        update(
          base,
          Message.EditingAction({
            action: EditorAction.cases.OpenEdit.make({}),
            personId: "fixture-person",
          })
        )
      );

      expect(existing._tag).toBe("Existing");
      expect(existing.primaryZone).toBe("America/Los_Angeles");

      const gesture = yield* capturedOpen(
        completeGesture(base, {
          allDayRow: false,
          duplicate: false,
          id: 1,
          range: {
            allDay: false,
            endDate: "2026-10-21",
            endTime: "11:00",
            startDate: "2026-10-21",
            startTime: "10:00",
          },
          target: Option.none(),
        })
      );

      expect(gesture._tag).toBe("New");
      expect(gesture).toMatchObject({
        primaryZone: "America/Los_Angeles",
        rangeZone: "Europe/London",
        startTime: "10:00",
      });
    }).pipe(Effect.provide(NodeServices.layer))
);

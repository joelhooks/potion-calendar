import { expect } from "@effect/vitest";
import { Effect, Fiber, Layer, Option, Queue, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";
import { vi } from "vitest";

import { update } from "../src/client/app.js";
import type { AppMessage } from "../src/client/app.js";
import {
  ObserveRsvpNoteFocus,
  NoteFocusObservation,
  RsvpNoteFocus,
  noteFocusObservation,
  withRsvpNoteFocusOwnership,
} from "../src/client/desktop/rsvp-note-focus.js";
import { rsvpNoteField } from "../src/client/desktop/rsvp-note.js";
import { view } from "../src/features/app.js";
import {
  RecoveryBusy,
  recoveryAdmission,
  recoveryBusyMessage,
  recoveryHost,
  recoveryInteraction,
  recoveryModel,
} from "./tray-note-recovery-fixture.js";

type FocusSignal =
  | { kind: "frame"; callback: FrameRequestCallback }
  | { kind: "done" };

export const noteFocusFixture = Effect.fn("NoteFocusTest.fixture")(
  function* noteFocusFixture(width: number) {
    const h = yield* recoveryHost(recoveryModel(width));
    yield* h.apply(recoveryAdmission());
    yield* h.receive();
    yield* h.apply(
      Option.getOrThrow(recoveryInteraction(h.model(), "type", "Focus draft"))
    );
    yield* h.receive();
    yield* h.receive();
    const signals = yield* Queue.unbounded<FocusSignal>();
    const original = [...document.body.childNodes];

    const oldFrame = Object.getOwnPropertyDescriptor(
      globalThis,
      "requestAnimationFrame"
    );

    const oldCancel = Object.getOwnPropertyDescriptor(
      globalThis,
      "cancelAnimationFrame"
    );

    const html = yield* renderToString(
      { init: () => ({ model: h.model() }), view },
      { isHydratable: false }
    );

    const dom = new DOMParser().parseFromString(html.html, "text/html");
    let windowFocused = true;

    const hasFocus = vi
      .spyOn(document, "hasFocus")
      .mockImplementation(() => windowFocused);

    const activate = vi.spyOn(window, "focus").mockImplementation(() => {
      throw new Error("Focus restoration activated the window");
    });

    let nextFrame = 0;
    const cancelled = new Set<number>();
    const outside = document.createElement("button");
    outside.textContent = "Other focus";
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        document.body.replaceChildren(...dom.body.childNodes, outside);

        const dialog = document.querySelector<HTMLDialogElement>(
          "#phone-shell-dialog"
        );

        if (width === 390 && dialog !== null) {
          dialog.open = true;
        }

        Object.defineProperty(globalThis, "requestAnimationFrame", {
          configurable: true,
          value: (paint: FrameRequestCallback) => {
            nextFrame += 1;
            const id = nextFrame;
            Queue.offerUnsafe(signals, {
              callback: (time) => {
                if (cancelled.has(id)) {
                  return;
                }

                paint(time);
              },
              kind: "frame",
            });

            return id;
          },
        });
        Object.defineProperty(globalThis, "cancelAnimationFrame", {
          configurable: true,
          value: (id: number) => cancelled.add(id),
        });
      }),
      () =>
        Effect.sync(() => {
          hasFocus.mockRestore();
          activate.mockRestore();
          document.body.replaceChildren(...original);

          if (oldFrame === undefined) {
            Reflect.deleteProperty(globalThis, "requestAnimationFrame");
          } else {
            Object.defineProperty(
              globalThis,
              "requestAnimationFrame",
              oldFrame
            );
          }

          if (oldCancel === undefined) {
            Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
          } else {
            Object.defineProperty(
              globalThis,
              "cancelAnimationFrame",
              oldCancel
            );
          }
        })
    );
    const context = yield* Layer.build(RsvpNoteFocus.layer);
    const focus = yield* RsvpNoteFocus.pipe(Effect.provide(context));
    const observation = noteFocusObservation(h.model());
    yield* focus.observe(observation);
    const target = Option.getOrThrow(observation.target);
    const field = rsvpNoteField(target.pane, target.token);

    if (field === undefined) {
      return yield* Effect.die("Root note field missing");
    }

    field.focus();
    expect(
      document.activeElement,
      "staged root field must own initial focus"
    ).toBe(field);
    field.setSelectionRange(1, 1);
    const restores = vi.spyOn(field, "focus");
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        restores.mockRestore();
      })
    );
    const rootUpdate = withRsvpNoteFocusOwnership(update);

    const patch = Effect.fn("NoteFocusTest.patch")(function* patch() {
      const rendered = yield* renderToString(
        { init: () => ({ model: h.model() }), view },
        { isHydratable: false }
      );

      const latest = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      const next = [
        ...latest.querySelectorAll<HTMLTextAreaElement>("#rsvp-note"),
      ].find(
        (element) =>
          (element.closest("#phone-shell-dialog") !== null) ===
          (target.pane === "phone")
      );

      if (next === undefined) {
        field.toggleAttribute("data-tray-rsvp-note", false);

        return yield* Effect.void;
      }

      if (next.disabled) {
        field.blur();
      }

      field.disabled = next.disabled;
      field.value = next.value;

      if (next.dataset.trayRsvpNote === undefined) {
        field.toggleAttribute("data-tray-rsvp-note", false);
      } else {
        field.dataset.trayRsvpNote = next.dataset.trayRsvpNote;
      }

      return yield* Effect.void;
    });

    const apply = Effect.fn("NoteFocusTest.apply")(function* apply(
      message: AppMessage
    ) {
      const result = rootUpdate(h.model(), message);
      yield* h.apply(message);
      yield* patch();

      const command = result.commands?.find(
        (item) => item.name === "ObserveRsvpNoteFocus"
      );

      if (command !== undefined) {
        const args = yield* Schema.decodeUnknownEffect(NoteFocusObservation)(
          command.args
        );

        yield* ObserveRsvpNoteFocus(args).effect.pipe(
          Effect.provideService(RsvpNoteFocus, focus)
        );
      }
    });

    const begin = Effect.fn("NoteFocusTest.begin")(function* begin(
      message: AppMessage
    ) {
      const fiber = yield* apply(message).pipe(
        Effect.ensuring(
          Effect.sync(() => Queue.offerUnsafe(signals, { kind: "done" }))
        ),
        Effect.forkScoped
      );

      const signal = yield* Queue.take(signals);

      return { fiber, signal };
    });

    const finish = Effect.fn("NoteFocusTest.finish")(function* finish(
      pending: Effect.Success<ReturnType<typeof begin>>
    ) {
      if (pending.signal.kind === "frame") {
        pending.signal.callback(0);
        expect((yield* Queue.take(signals)).kind).toBe("done");
      }

      yield* Fiber.join(pending.fiber);
    });

    const busyMessage = (busy: boolean) =>
      recoveryBusyMessage(h.model(), RecoveryBusy.make("rsvp"), busy);

    const moveElsewhere = (backToBody: boolean) => {
      outside.focus();

      if (backToBody) {
        outside.blur();
      }
    };

    return {
      apply,
      begin,
      busyMessage,
      field,
      finish,
      focus,
      h,
      moveElsewhere,
      outside,
      restores,
      setWindowFocused: (value: boolean) => {
        windowFocused = value;
      },
      target,
    };
  }
);

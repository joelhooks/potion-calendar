import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";
import type { HtmlBuilder } from "foldkit/html";
import { Scene } from "foldkit/test";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { observeKeyboard } from "../src/client/keyboard/input.js";
import { reconcileModalDialog } from "../src/client/phone-shell/dialog.js";
import { view } from "../src/features/app.js";
import { phoneShellDialog, phoneToolbar } from "../src/features/phone-shell.js";
import { installPhoneDialogStandIn } from "./phone-dialog-stand-in.js";
import { phoneShellFixture } from "./phone-shell-fixture.js";

const shellView = (model: AppModel, h: HtmlBuilder<AppMessage>) =>
  h.div([], [phoneToolbar(model, h), ...phoneShellDialog(model, h)]);

it.effect(
  "root Calendars and panel controls reach the real shell lifecycle",
  () =>
    Effect.sync(() => {
      Scene.scene(
        { update, view: shellView },
        Scene.given(phoneShellFixture(390, 844)),
        Scene.click(Scene.role("button", { name: /^Calendars$/u })),
        Scene.expect(Scene.role("dialog", { name: "Calendars" })).toExist(),
        Scene.click(Scene.role("button", { name: "Close phone panel" })),
        Scene.expect(Scene.role("dialog", { name: "Calendars" })).not.toExist(),
        Scene.click(Scene.role("button", { name: /^Upcoming$/u })),
        Scene.expect(
          Scene.role("dialog", { name: "Upcoming meeting" })
        ).toExist()
      );
    })
);

it.effect(
  "native drawer modal cancellation and removal return focus to the Calendars opener",
  () =>
    Effect.gen(function* drawerFocus() {
      const initial = phoneShellFixture(390, 844, "details");

      const { model } = update(
        initial,
        Message.PhoneShellOpened({ mode: "drawer" })
      );

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const root = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const element = document.createElement("div");
          element.innerHTML = rendered.html;
          document.body.append(element);

          return element;
        }),
        (element) =>
          Effect.sync(() => {
            element.remove();
          })
      );

      const button = root.querySelector<HTMLButtonElement>(
        "#phone-calendars-button"
      );

      const dialog = root.querySelector<HTMLDialogElement>(
        "[data-phone-shell-dialog]"
      );

      expect(button).not.toBeNull();
      expect(dialog).not.toBeNull();

      if (button === null || dialog === null) {
        return;
      }

      const { close, show } = installPhoneDialogStandIn(dialog);

      const onClose = vi.fn();
      button.focus();

      const dispose = yield* Effect.acquireRelease(
        Effect.sync(() =>
          reconcileModalDialog(root, {
            close: () => {
              onClose();
            },
            fallbackId: "phone-calendars-button",
            selector: "[data-phone-shell-dialog]",
          })
        ),
        (cleanup) => Effect.sync(cleanup)
      );

      expect(show).toHaveBeenCalledTimes(1);
      dialog.querySelector<HTMLButtonElement>("button")?.focus();
      const cancel = new Event("cancel", { bubbles: false, cancelable: true });
      dialog.dispatchEvent(cancel);
      expect(cancel.defaultPrevented).toBe(true);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(model.calendar.selected.length).toBeGreaterThan(0);

      const escape = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      });

      dialog.querySelector<HTMLButtonElement>("button")?.dispatchEvent(escape);
      expect(escape.defaultPrevented).toBe(true);
      expect(onClose).toHaveBeenCalledTimes(2);
      expect(
        Option.isNone(observeKeyboard(model, escape, model.calendar.now))
      ).toBe(true);
      expect(model.calendar.selected).toEqual(initial.calendar.selected);

      yield* Effect.callback<boolean>((resume) => {
        const checkpoint = new MutationObserver(() => {
          checkpoint.disconnect();
          resume(Effect.succeed(true));
        });

        checkpoint.observe(root, { childList: true, subtree: true });
        dialog.remove();

        return Effect.sync(() => {
          checkpoint.disconnect();
        });
      });

      expect(document.activeElement).toBe(button);
      expect(close).toHaveBeenCalledTimes(1);
      dispose();
    })
);

it.effect(
  "desktop root bytes stay identical when real CSS width arrives at 641 or wider",
  () =>
    Effect.gen(function* desktopBytes() {
      const before = phoneShellFixture(1440, 900);

      const desktop = {
        ...before,
        phoneShell: { ...before.phoneShell, viewportWidth: undefined },
      };

      const original = yield* renderToString(
        { init: () => ({ model: desktop }), view },
        { isHydratable: false }
      );

      const measured = update(
        desktop,
        Message.MeasuredShellViewport({ width: 641 })
      ).model;

      const after = yield* renderToString(
        { init: () => ({ model: measured }), view },
        { isHydratable: false }
      );

      expect(after.html).toBe(original.html);
      expect(after.html).not.toContain("phone-toolbar");
    })
);

it.effect.prop(
  "phone panels put their title and close in a dedicated header before content",
  { mode: Schema.Literals(["drawer", "details", "upcoming"]) },
  ({ mode }) =>
    Effect.gen(function* panelHeader() {
      const model = phoneShellFixture(390, 844, mode);

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const root = document.createElement("div");
      root.innerHTML = rendered.html;
      const dialog = root.querySelector("[data-phone-shell-dialog]");
      const header = dialog?.querySelector(":scope > header");
      const content = dialog?.querySelector(":scope > .phone-panel-content");

      expect(header, `${mode} needs a dedicated header`).not.toBeNull();
      expect(header?.nextElementSibling).toBe(content);
      expect(header?.querySelector("button")?.getAttribute("aria-label")).toBe(
        "Close phone panel"
      );
      expect(header?.querySelector("h2")?.textContent).toBe(
        {
          details: "Product review",
          drawer: "Calendars",
          upcoming: "Upcoming meeting",
        }[mode]
      );

      if (mode === "details") {
        expect(
          content?.querySelectorAll(".detail-panel > h2, .close-detail").length
        ).toBe(0);
      }
    })
);

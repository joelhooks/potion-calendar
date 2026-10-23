import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";
import { vi } from "vitest";

import { Message } from "../src/client/app.js";
import { attachPhoneShell } from "../src/client/phone-shell/mount.js";
import type { PhoneShellMessage } from "../src/client/phone-shell/mount.js";
import { view } from "../src/features/app.js";
import { installPhoneDialogStandIn } from "./phone-dialog-stand-in.js";
import { phoneShellFixture } from "./phone-shell-fixture.js";

it.effect.prop(
  "the sole viewport mount reads real CSS width and detaches after native drawer dismissal",
  {
    width: Schema.Literals([390, 640, 641]),
  },
  ({ width }) =>
    Effect.gen(function* measuredShell() {
      const model = phoneShellFixture(width, 844, "drawer");

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

      const dialog = root.querySelector<HTMLDialogElement>(
        "[data-phone-shell-dialog]"
      );

      const measurement = vi
        .spyOn(document.documentElement, "clientWidth", "get")
        .mockReturnValue(width);

      const messages: PhoneShellMessage[] = [];

      if (dialog !== null) {
        installPhoneDialogStandIn(dialog);
      }

      const stop = yield* Effect.acquireRelease(
        Effect.sync(() =>
          attachPhoneShell(root, (message) => {
            messages.push(message);
          })
        ),
        (dispose) => Effect.sync(dispose)
      );

      expect(messages).toEqual([Message.MeasuredShellViewport({ width })]);
      measurement.mockReturnValue(width + 1);
      window.dispatchEvent(new Event("resize"));
      expect(messages.at(-1)).toEqual(
        Message.MeasuredShellViewport({ width: width + 1 })
      );

      if (dialog !== null) {
        const bounds = dialog.getBoundingClientRect();
        dialog.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            clientX: bounds.right + 10,
            clientY: bounds.bottom + 10,
          })
        );
        expect(messages.at(-1)).toEqual(Message.PhoneShellClosed());
        const before = messages.length;
        root.querySelector<HTMLButtonElement>(".sidebar button")?.click();
        expect(messages.length).toBe(before + 1);
        expect(messages.at(-1)).toEqual(Message.PhoneShellClosed());
      }

      stop();
      const count = messages.length;
      window.dispatchEvent(new Event("resize"));
      expect(messages.length).toBe(count);
      measurement.mockRestore();
    })
);

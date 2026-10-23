import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import { view } from "../src/features/app.js";
import { reminderCardScene } from "./reminder-card-fixture.js";

it.effect.each([
  {
    name: "light 1440 before start",
    started: false,
    theme: "light",
    width: 1440,
  },
  { name: "dark 900 after start", started: true, theme: "dark", width: 900 },
  {
    name: "light phone 390 before start",
    started: false,
    theme: "light",
    width: 390,
  },
] as const)(
  "the actual reminder card exposes the web snooze choices: $name",
  (scene) =>
    Effect.gen(function* snoozeChoices() {
      const { model } = reminderCardScene("reminder", scene.theme, scene.width);
      const [notification] = model.reminders.context.active;
      expect(notification).toBeDefined();

      if (notification === undefined) {
        return yield* Effect.die(new Error("Missing reminder fixture"));
      }

      const measured = update(
        model,
        Message.MeasuredShellViewport({ width: scene.width })
      ).model;

      const ready = scene.started
        ? update(
            measured,
            Message.Ticked({ now: notification.candidate.start + 1 })
          ).model
        : measured;

      const rendered = yield* renderToString(
        { init: () => ({ model: ready }), view },
        { isHydratable: false }
      );

      const root = document.createElement("div");
      root.innerHTML = rendered.html;

      const menu = root.querySelector<HTMLDetailsElement>(
        ".reminder-card details.reminder-snooze"
      );

      expect(menu).not.toBeNull();
      expect(menu?.querySelector("summary")?.textContent).toBe("Snooze");
      expect(
        [...root.querySelectorAll(".reminder-snooze button")].map(
          (button) => button.textContent
        )
      ).toEqual([
        "1 minute",
        "5 minutes",
        "15 minutes",
        "30 minutes",
        "60 minutes",
        "1440 minutes",
        ...(scene.started ? [] : ["Until start"]),
      ]);
      expect(root.querySelector(".reminder-card h2")?.textContent).toBe(
        notification.candidate.title
      );

      return yield* Effect.void;
    })
);

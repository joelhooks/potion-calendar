import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import { isPhoneShell } from "../src/client/phone-shell/model.js";
import { view } from "../src/features/app.js";
import { phoneShellFixture } from "./phone-shell-fixture.js";

it.effect.prop(
  "the real CSS viewport boundary is inclusive at 640 and independent of the grid width",
  { width: Schema.Literals([390, 430, 639, 640, 641, 750, 1440]) },
  ({ width }) =>
    Effect.gen(function* phoneBoundary() {
      const initial = phoneShellFixture(430, 932);

      const before = {
        ...initial,
        calendar: { ...initial.calendar, viewportWidth: 200 },
      };

      const measured = update(
        before,
        Message.MeasuredShellViewport({ width })
      ).model;

      const opened = update(
        measured,
        Message.PhoneShellOpened({ mode: "drawer" })
      ).model;

      const { html } = yield* renderToString(
        { init: () => ({ model: opened }), view },
        { isHydratable: false }
      );

      expect(isPhoneShell(opened), `CSS viewport ${width}`).toBe(width <= 640);
      expect(opened.calendar.viewportWidth).toBe(200);
      expect(
        html.includes('class="phone-toolbar"'),
        `root phone toolbar at ${width}`
      ).toBe(width <= 640);
      expect(opened.phoneShell.mode).toBe(width <= 640 ? "drawer" : "closed");
      expect(opened.settings).toEqual(initial.settings);
    })
);

it.effect.prop(
  "closing each phone overlay retains selection and desktop resize closes the transient mode",
  { mode: Schema.Literals(["drawer", "details", "upcoming"]) },
  ({ mode }) =>
    Effect.sync(() => {
      const initial = phoneShellFixture(390, 844, mode);
      const closed = update(initial, Message.PhoneShellClosed()).model;

      const resized = update(
        initial,
        Message.MeasuredShellViewport({ width: 641 })
      ).model;

      expect(closed.phoneShell.mode).toBe("closed");
      expect(closed.calendar.selected).toEqual(initial.calendar.selected);
      expect(resized.phoneShell.mode).toBe("closed");
      expect(resized.settings).toEqual(initial.settings);
    })
);

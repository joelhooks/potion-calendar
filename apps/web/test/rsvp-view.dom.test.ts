import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { bindingHints } from "../src/client/keyboard/registry.js";
import { view } from "../src/features/app.js";
import { keyboardFixture } from "./keyboard-fixture.js";

const render = (model: AppModel) =>
  renderToString(
    { init: () => ({ model }), view },
    { isHydratable: false }
  ).pipe(
    Effect.map(({ html }) => new DOMParser().parseFromString(html, "text/html"))
  );

it.effect(
  "RSVP controls project the registry's E window and show the same hints as menu and page",
  () =>
    Effect.gen(function* rsvpHints() {
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

      const controls = yield* render(prefix);

      const hint = controls.querySelector(
        ".event-rsvp [role='status']"
      )?.textContent;

      expect(hint).toBe("E then Y Yes · E then N No · E then M Maybe");

      const menu = yield* render(
        update(base, Message.KeyboardAction({ id: "commands" })).model
      );

      const page = yield* render(
        update(base, Message.KeyboardAction({ id: "shortcuts" })).model
      );

      for (const id of ["rsvp-yes", "rsvp-no", "rsvp-maybe"]) {
        const keys = bindingHints(id).join(" / ");
        expect(hint).toContain(keys);
        expect(menu.querySelector(`#command-${id}`)?.textContent).toContain(
          keys
        );
        expect(
          page.querySelector(`[data-shortcut-id="${id}"] kbd`)?.textContent
        ).toBe(keys);
      }

      const cleared = yield* render(
        update(prefix, Message.KeyboardResetSequence()).model
      );

      expect(cleared.querySelector(".event-rsvp [role='status']")).toBeNull();
    })
);

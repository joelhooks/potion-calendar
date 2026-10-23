import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, FileSystem, Option, Stream } from "effect";
import { renderToString } from "foldkit/experimental/server";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import {
  keyboardMessage,
  observeKeyboard,
} from "../src/client/keyboard/input.js";
import { keyboardStream } from "../src/client/keyboard/subscription.js";
import { view } from "../src/features/app.js";
import { editingFixture } from "./editor-fixture.js";
import { keyboardFixture } from "./keyboard-fixture.js";
import { phoneShellFixture } from "./phone-shell-fixture.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

const contexts = [
  "grid",
  "dialog",
  "command-input",
  "editor-title",
  "shortcuts-input",
] as const;

const refreshScene = (context: (typeof contexts)[number]) => {
  const base = keyboardFixture();

  if (context === "editor-title") {
    return {
      model: {
        ...base,
        editing: { ...base.editing, owner: base.person, view: editingFixture },
      },
      selector: "#event-title",
    };
  }

  if (context === "shortcuts-input") {
    return {
      model: update(base, Message.KeyboardAction({ id: "shortcuts" })).model,
      selector: "#shortcuts-query",
    };
  }

  if (context === "dialog" || context === "command-input") {
    return {
      model: update(base, Message.KeyboardAction({ id: "commands" })).model,
      selector:
        context === "dialog" ? "#keyboard-command-dialog" : "#keyboard-query",
    };
  }

  return { model: base, selector: "#time-viewport" };
};

it.effect.each(
  ["MacIntel", "Win32"].flatMap((platform) =>
    contexts.map((context) => ({ context, platform }))
  )
)(
  "literal Control-R reaches Refresh once through the real window subscription: %j",
  ({ context, platform }) =>
    Effect.gen(function* subscribedControlRefresh() {
      const spy = vi
        .spyOn(navigator, "platform", "get")
        .mockReturnValue(platform);

      const host = document.createElement("div");
      document.body.append(host);
      const addListener = window.addEventListener;
      const ready = yield* Deferred.make<boolean>();

      const listenerSpy = vi
        .spyOn(window, "addEventListener")
        .mockImplementation((type, listener, options) => {
          addListener.call(window, type, listener, options);

          if (type === "keydown") {
            Deferred.doneUnsafe(ready, Effect.succeed(true));
          }
        });

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          listenerSpy.mockRestore();
          spy.mockRestore();
          host.remove();
        })
      );

      const { model, selector } = refreshScene(context);

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      host.innerHTML = rendered.html;

      const target = yield* Effect.fromNullishOr(
        host.querySelector<HTMLElement>(selector)
      );

      const waiting = yield* Effect.forkChild(
        keyboardStream(() => model).pipe(Stream.runHead)
      );

      yield* Deferred.await(ready);

      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: "r",
      });

      target.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      const message = Option.getOrThrow(yield* Fiber.join(waiting));
      const result = update(model, message);
      expect(result.commands?.map((command) => command.name)).toEqual(
        update(model, Message.ClickedRefresh()).commands?.map(
          (command) => command.name
        )
      );
      expect(result.commands ?? []).not.toHaveLength(0);
      expect(
        result.commands?.every((command) => command.name === "RefreshEvents")
      ).toBe(true);
      expect(result.model.editing.view).toBe(model.editing.view);
      expect(result.model.keyboard.screen).toBe(model.keyboard.screen);

      const after = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: "r",
      });

      target.dispatchEvent(after);
      expect(after.defaultPrevented).toBe(false);
    }).pipe(Effect.scoped)
);

it.effect.each(["MacIntel", "Win32"])(
  "browser reload and plain text R retain ownership on %s",
  (platform) =>
    Effect.gen(function* retainedKeyOwnership() {
      const spy = vi
        .spyOn(navigator, "platform", "get")
        .mockReturnValue(platform);

      const host = document.createElement("div");
      document.body.append(host);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          spy.mockRestore();
          host.remove();
        })
      );

      for (const context of contexts) {
        const { model, selector } = refreshScene(context);

        const rendered = yield* renderToString(
          { init: () => ({ model }), view },
          { isHydratable: false }
        );

        host.innerHTML = rendered.html;

        const target = yield* Effect.fromNullishOr(
          host.querySelector<HTMLElement>(selector)
        );

        for (const modifiers of [
          { metaKey: true },
          { ctrlKey: true, metaKey: true },
          { altKey: true, ctrlKey: true },
          { ctrlKey: true, shiftKey: true },
        ]) {
          const event = new KeyboardEvent("keydown", {
            ...modifiers,
            bubbles: true,
            cancelable: true,
            key: "r",
          });

          target.addEventListener(
            "keydown",
            (received) => {
              expect(
                Option.isNone(
                  observeKeyboard(model, received, model.calendar.now)
                )
              ).toBe(true);
            },
            { once: true }
          );
          target.dispatchEvent(event);
          expect(event.defaultPrevented).toBe(false);
        }

        if (context !== "grid" && context !== "dialog") {
          const event = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "r",
          });

          target.addEventListener(
            "keydown",
            (received) => {
              expect(
                Option.isNone(
                  observeKeyboard(model, received, model.calendar.now)
                )
              ).toBe(true);
            },
            { once: true }
          );
          target.dispatchEvent(event);
          expect(event.defaultPrevented).toBe(false);
        }
      }
    }).pipe(Effect.scoped)
);

it.effect(
  "held Control-R suppresses browser reload without dispatching another refresh",
  () =>
    Effect.sync(() => {
      const model = keyboardFixture();

      const event = new KeyboardEvent("keydown", {
        cancelable: true,
        ctrlKey: true,
        key: "r",
        repeat: true,
      });

      expect(
        Option.isNone(observeKeyboard(model, event, model.calendar.now))
      ).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      expect(
        Option.isNone(
          keyboardMessage(
            model,
            new KeyboardEvent("keydown", {
              ctrlKey: true,
              isComposing: true,
              key: "r",
            }),
            1,
            "MacIntel"
          )
        )
      ).toBe(true);
    })
);

it.effect.each(["MacIntel", "Win32"])(
  "Refresh aliases share the existing page and command-menu formatting on %s",
  (platform) =>
    Effect.gen(function* refreshHints() {
      const spy = vi
        .spyOn(navigator, "platform", "get")
        .mockReturnValue(platform);

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          spy.mockRestore();
        })
      );
      const expected = platform === "MacIntel" ? "R / ⌃R" : "R / Ctrl+R";

      for (const [id, selector] of [
        ["shortcuts", '[data-shortcut-id="refresh"]'],
        ["commands", "#command-refresh"],
      ] as const) {
        const { model } = update(
          keyboardFixture(),
          Message.KeyboardAction({ id })
        );

        const rendered = yield* renderToString(
          { init: () => ({ model }), view },
          { isHydratable: false }
        );

        const doc = new DOMParser().parseFromString(rendered.html, "text/html");
        const row = yield* Effect.fromNullishOr(doc.querySelector(selector));
        expect(row.textContent).toContain(expected);
        expect(row.textContent).not.toContain("⌘R");
      }
    }).pipe(Effect.scoped)
);

it.effect(
  "exports the actual light 900 Shortcuts refresh alias for desk capture",
  () =>
    Effect.gen(function* exportControlRefreshHint() {
      const fs = yield* FileSystem.FileSystem;

      const spy = vi
        .spyOn(navigator, "platform", "get")
        .mockReturnValue("MacIntel");

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          spy.mockRestore();
        })
      );
      const base = phoneShellFixture(900, 900, "closed", "light");

      const { model: opened } = update(
        base,
        Message.KeyboardAction({ id: "shortcuts" })
      );

      const { model } = update(
        opened,
        Message.KeyboardQuery({ query: "refresh" })
      );

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const doc = new DOMParser().parseFromString(rendered.html, "text/html");

      const row = yield* Effect.fromNullishOr(
        doc.querySelector('[data-shortcut-id="refresh"]')
      );

      expect(row.textContent).toContain("R / ⌃R");
      const css = yield* fs.readFileString("src/client/style.css");
      const proof = `if(innerWidth!==900||innerHeight!==900)throw Error('Exact 900 by 900 viewport required');const row=document.querySelector('[data-shortcut-id="refresh"]');if(!row||!row.textContent.includes('R / ⌃R'))throw Error('Missing literal Control-R refresh alias');if(row.textContent.includes('⌘R'))throw Error('Browser Command-R must remain unadvertised');const box=row.getBoundingClientRect();if(box.width<=0||box.height<=0)throw Error('Refresh hint row has no geometry');if(box.left<0||box.right>innerWidth+1||box.top<0||box.bottom>innerHeight+1)throw Error('Refresh hint must be visible in the declared viewport');document.documentElement.dataset.fixtureReady='control-refresh';`;
      const html = `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="fixture-viewport" content="900x900"><meta name="fixture-keyboard-platform" content="MacIntel"><title>Literal Control-R refresh</title><style>${css}</style></head><body>${rendered.html}<script>${proof}</script></body></html>`;
      yield* publishFixtureArtifact(
        "../../.git/control-refresh-shortcuts-light-900-fixture.html",
        html
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

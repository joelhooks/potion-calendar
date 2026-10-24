// @effect-diagnostics-next-line nodeBuiltinImport:off -- Local review exports carry exact SHA-256 hashes without running a browser.
import { createHash } from "node:crypto";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Desktop-owned source fixtures read and write only bounded local review artifacts.
import { readFileSync, writeFileSync } from "node:fs";

import type {
  AgendaEventValue,
  PromptAction,
  PromptBridge,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import { vi } from "vitest";

import "../src/client/globals.js";

const meeting: AgendaEventValue = {
  allDay: false,
  calendarColor: "#64748b",
  conferenceUrl: "https://meet.example.test/room",
  end: 3_600_000,
  hasLocation: false,
  hasParticipants: true,
  key: { accountId: "work", calendarId: "primary", eventId: "card" },
  participantEmails: ["guest@example.test"],
  responseStatus: "accepted",
  start: 120_000,
  title: "Saved meeting",
};

const mount = Effect.fn("FakePromptRenderer.mount")(function* mount(
  events: readonly AgendaEventValue[] = [meeting]
) {
  const calls: (typeof PromptAction.Type)[] = [];
  const descriptor = Object.getOwnPropertyDescriptor(window, "potionPrompt");

  const bridge: PromptBridge = {
    act: (action) => {
      calls.push(action);
    },
    // @effect-diagnostics-next-line asyncFunction:off -- The fake implements the isolated preload's native Promise boundary.
    getView: async () => await Promise.resolve({ events, revision: 1 }),
    onView: () => () => {},
  };

  yield* Effect.acquireRelease(
    Effect.sync(() => {
      document.body.innerHTML = "<main></main>";
      Object.defineProperty(window, "potionPrompt", {
        configurable: true,
        value: bridge,
      });
      vi.resetModules();
    }),
    () =>
      Effect.sync(() => {
        window.dispatchEvent(new Event("pagehide"));

        if (descriptor === undefined) {
          Reflect.deleteProperty(window, "potionPrompt");
        } else {
          Object.defineProperty(window, "potionPrompt", descriptor);
        }

        document.body.replaceChildren();
      })
  );
  yield* Effect.promise(
    // @effect-diagnostics-next-line asyncFunction:off -- Loading the actual renderer module crosses the test runner's native module Promise boundary.
    async () => await import("../src/client/prompt.js")
  );
  // @effect-diagnostics-next-line asyncFunction:off -- The native preload read must settle before querying its rendered controls.
  yield* Effect.promise(async () => {
    await Promise.resolve();
  });

  return { calls };
});

const control = (selector: string): HTMLButtonElement => {
  const found = document.querySelector<HTMLButtonElement>(selector);
  expect(found).not.toBeNull();

  if (found === null) {
    throw new Error("The asserted renderer control is absent");
  }

  return found;
};

it.effect(
  "the actual prompt menu exposes exactly three actions and does not show the body",
  () =>
    Effect.gen(function* menuRecipient() {
      const { calls } = yield* mount();
      control("[data-prompt-menu]").click();
      expect(
        [...document.querySelectorAll('[role="menuitem"]')].map(
          (item) => item.textContent
        )
      ).toEqual(["Email participants", "Snooze for 1 minute", "Show event"]);
      expect(calls).toEqual([]);
      control('[data-prompt-item="email"]').click();
      expect(calls).toEqual([{ action: "email", key: meeting.key }]);
    }).pipe(Effect.scoped)
);

it.effect(
  "Snooze and close each dispatch only their own action, never the card body",
  () =>
    Effect.gen(function* snoozeRecipient() {
      const { calls } = yield* mount();
      control("[data-prompt-menu]").click();
      control('[data-prompt-item="snooze"]').click();
      expect(calls).toEqual([{ action: "snooze", key: meeting.key }]);
      const close = control("[data-prompt-dismiss]");
      expect(close.getAttribute("aria-label")).toBe("Dismiss Saved meeting");
      close.click();
      expect(calls).toEqual([
        { action: "snooze", key: meeting.key },
        { action: "dismiss", key: meeting.key },
      ]);
    }).pipe(Effect.scoped)
);

const key = (value: string) =>
  new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: value });

it.effect.prop(
  "keyboard arrows skip disabled Email and Escape closes only the menu",
  {
    emailEnabled: Arbitrary.schema(Schema.Boolean),
    openKey: Arbitrary.schema(Schema.Literals(["Enter", " "])),
  },
  ({ emailEnabled, openKey }) =>
    Effect.gen(function* keyboardMenu() {
      const { calls } = yield* mount([
        {
          ...meeting,
          participantEmails: emailEnabled ? meeting.participantEmails : [],
        },
      ]);

      const menu = control("[data-prompt-menu]");

      menu.dispatchEvent(key(openKey));
      expect(control('[data-prompt-item="email"]').disabled).toBe(
        !emailEnabled
      );

      const first = control(
        emailEnabled
          ? '[data-prompt-item="email"]'
          : '[data-prompt-item="snooze"]'
      );

      expect(document.activeElement).toBe(first);
      document.activeElement?.dispatchEvent(key("ArrowDown"));
      expect(document.activeElement).toBe(
        control(
          emailEnabled
            ? '[data-prompt-item="snooze"]'
            : '[data-prompt-item="show"]'
        )
      );
      document.activeElement?.dispatchEvent(key("ArrowUp"));
      expect(document.activeElement).toBe(first);
      document.activeElement?.dispatchEvent(key("End"));
      expect(document.activeElement).toBe(control('[data-prompt-item="show"]'));
      document.activeElement?.dispatchEvent(key("Home"));
      expect(document.activeElement).toBe(first);
      document.activeElement?.dispatchEvent(key("Escape"));
      expect(menu.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(menu);
      expect(calls).toEqual([]);
    }).pipe(Effect.scoped)
);

it.effect(
  "exports the actual isolated prompt renderer as source-only light/dark one/two-card fixtures",
  () =>
    Effect.gen(function* promptExports() {
      const css = yield* Effect.sync(() =>
        readFileSync("src/client/prompt.css", "utf-8")
      );

      const fixtures: {
        readonly file: string;
        readonly cards: number;
        readonly theme: string;
        readonly menu: string;
        readonly menuAvailable: boolean;
        readonly width: number;
        readonly height: number;
        readonly sha256: string;
      }[] = [];

      for (const count of [1, 2]) {
        const cards =
          count === 1
            ? [meeting]
            : [
                meeting,
                {
                  ...meeting,
                  key: { ...meeting.key, eventId: "second-card" },
                  title: "Second saved meeting",
                },
              ];

        for (const theme of ["light", "dark"]) {
          for (const state of ["closed", "open"]) {
            const rendered = yield* Effect.gen(function* renderPrompt() {
              yield* mount(cards);

              const menu =
                document.querySelector<HTMLButtonElement>("[data-prompt-menu]");

              if (state === "open") {
                menu?.click();
              }

              expect(document.querySelectorAll("article")).toHaveLength(count);

              return {
                body: document.body.innerHTML,
                menuAvailable: menu !== null,
              };
            }).pipe(Effect.scoped);

            const file = `prompt-actions-${theme}-380-${count}-${state}-fixture.html`;
            const html = `<!doctype html><html lang="en" style="color-scheme:${theme}"><head><meta charset="utf-8"><meta name="fixture-viewport" content="380x${70 + count * 100}"><title>Prompt actions ${theme} ${count} ${state}</title><style>${css}</style></head><body>${rendered.body}</body></html>`;
            yield* Effect.sync(() => {
              writeFileSync(`../../.git/${file}`, html, { mode: 0o600 });
            });
            fixtures.push({
              cards: count,
              file,
              height: 70 + count * 100,
              menu: state,
              menuAvailable: rendered.menuAvailable,
              sha256: createHash("sha256").update(html).digest("hex"),
              theme,
              width: 380,
            });
          }
        }
      }

      expect(fixtures).toHaveLength(8);
      yield* Effect.sync(() => {
        writeFileSync(
          "../../.git/prompt-actions-fixture-manifest.json",
          JSON.stringify(
            {
              fixtures,
              method:
                "Node DOM serialization from the actual isolated renderer; not layout, browser, OS or audio proof",
              schemaVersion: 1,
            },
            null,
            2
          ),
          { mode: 0o600 }
        );
      });
    }).pipe(Effect.scoped)
);

const point = (
  target: HTMLElement,
  type: string,
  x: number,
  y: number,
  at: number
) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX: x,
    clientY: y,
  });

  Object.defineProperties(event, {
    isPrimary: { value: true },
    pointerId: { value: 1 },
    timeStamp: { value: at },
  });
  target.dispatchEvent(event);

  return event;
};

it.effect.each([
  { dismiss: true, dx: 161, dy: 0, elapsed: 2000 },
  { dismiss: false, dx: 160, dy: 0, elapsed: 2000 },
  { dismiss: true, dx: 16, dy: 0, elapsed: 20 },
  { dismiss: false, dx: -200, dy: 0, elapsed: 20 },
  { dismiss: false, dx: 180, dy: 181, elapsed: 20 },
])(
  "the actual renderer routes a pointer gesture exactly once and consumes its following body click: %j",
  ({ dismiss, dx, dy, elapsed }) =>
    Effect.gen(function* pointerRecipient() {
      const { calls } = yield* mount();
      const article = document.querySelector<HTMLElement>("[data-prompt-card]");
      expect(article).not.toBeNull();

      if (article === null) {
        throw new Error("The asserted card is absent");
      }

      Object.defineProperty(article, "getBoundingClientRect", {
        value: () => new DOMRect(0, 0, 400, 100),
      });
      point(article, "pointerdown", 0, 0, 1000);
      const move = point(article, "pointermove", dx, dy, 1000 + elapsed / 2);

      if (Math.abs(dy) > Math.abs(dx)) {
        expect(move.defaultPrevented).toBe(false);
      }

      point(article, "pointerup", dx, dy, 1000 + elapsed);
      article.click();
      expect(calls).toEqual(
        dismiss ? [{ action: "dismiss", key: meeting.key }] : []
      );
      expect(article.style.transform).toBe("");
    }).pipe(Effect.scoped)
);

it.effect(
  "menu Show is a single Show action and a control cannot start a dismissing swipe",
  () =>
    Effect.gen(function* showMenuRecipient() {
      const { calls } = yield* mount();
      const menu = control("[data-prompt-menu]");
      point(menu, "pointerdown", 0, 0, 0);
      point(menu, "pointermove", 400, 0, 1);
      point(menu, "pointerup", 400, 0, 2);
      expect(calls).toEqual([]);
      menu.click();
      control('[data-prompt-item="show"]').click();
      expect(calls).toEqual([{ action: "show", key: meeting.key }]);
    }).pipe(Effect.scoped)
);

it.effect(
  "a card body and its Show menu item reach only Show, while Join stays separate",
  () =>
    Effect.gen(function* bodyRecipient() {
      const { calls } = yield* mount();
      const body = document.querySelector<HTMLElement>("[data-prompt-body]");
      expect(body).not.toBeNull();
      body?.click();
      expect(calls).toEqual([{ action: "show", key: meeting.key }]);
      control("[data-prompt-join]").click();
      expect(calls).toEqual([
        { action: "show", key: meeting.key },
        { action: "join", key: meeting.key },
      ]);
    }).pipe(Effect.scoped)
);

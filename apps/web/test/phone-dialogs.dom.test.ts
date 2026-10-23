import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";
import { Scene } from "foldkit/test";

import { Message, update } from "../src/client/app.js";
import type { AppMessage, AppModel } from "../src/client/app.js";
import { PrepareEditingDialogs } from "../src/client/editing/dialog-mount.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { PrepareKeyboard } from "../src/client/keyboard/mount.js";
import { attachPhoneRouteSheets } from "../src/client/phone-shell/route-dialogs.js";
import type { PhoneRouteMessage } from "../src/client/phone-shell/route-dialogs.js";
import { PrepareSearch } from "../src/client/search/commands.js";
import { view } from "../src/features/app.js";
import { phoneDialogCss } from "../src/features/phone-dialogs.js";
import {
  AccountSettingsRoute,
  CalendarRoute,
  SettingsRoute,
} from "../src/layout/route.js";
import { installPhoneDialogStandIn } from "./phone-dialog-stand-in.js";
import {
  phoneDialogSelector,
  phoneDialogSurfaces,
  phoneDialogsFixture,
} from "./phone-dialogs-fixture.js";
import { phoneShellFixture } from "./phone-shell-fixture.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

const renderPhone = Effect.fn("phoneDialogs.render")(function* renderPhone(
  model: ReturnType<typeof phoneDialogsFixture>
) {
  const rendered = yield* renderToString(
    { init: () => ({ model }), view },
    { isHydratable: false }
  );

  const root = document.createElement("div");
  root.innerHTML = rendered.html;

  return root;
});

const matchedDeclarations = (
  node: Element,
  css: string,
  width: number,
  coarse: boolean
): readonly CSSStyleDeclaration[] => {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);

  try {
    const matched: CSSStyleDeclaration[] = [];

    const visit = (rules: CSSRuleList): void => {
      for (const rule of rules) {
        if (rule instanceof CSSMediaRule) {
          const maximum = /max-width:\s*(?<pixels>\d+)px/u.exec(
            rule.conditionText
          );

          if (
            (maximum === null || width <= Number(maximum.groups?.pixels)) &&
            (rule.conditionText !== "(pointer: coarse)" || coarse)
          ) {
            visit(rule.cssRules);
          }
        } else if (
          rule instanceof CSSStyleRule &&
          node.matches(rule.selectorText)
        ) {
          matched.push(rule.style);
        }
      }
    };

    if (style.sheet === null) {
      throw new Error("Missing phone policy stylesheet");
    }

    visit(style.sheet.cssRules);

    return matched;
  } finally {
    style.remove();
  }
};

it.effect.each(
  phoneDialogSurfaces.flatMap((surface) =>
    [390, 430, 640, 641].map((width) => ({ surface, width }))
  )
)(
  "phone sheets use the real shell viewport at both review widths and never at 641: %j",
  ({ surface, width }) =>
    Effect.gen(function* sheetBoundary() {
      const model = phoneDialogsFixture(surface, width, 932);
      const root = yield* renderPhone(model);
      expect(model.calendar.viewportWidth).toBeGreaterThan(0);
      expect(model.phoneShell.viewportWidth).toBe(width);
      expect(root.querySelector("#phone-dialog-styles") !== null).toBe(
        width <= 640
      );

      if (surface === "settings" || surface === "search") {
        expect(root.querySelector(phoneDialogSelector(surface)) !== null).toBe(
          width <= 640
        );
      }

      const dialog = root.querySelector(phoneDialogSelector(surface));

      if (dialog !== null) {
        dialog.setAttribute("open", "");

        const declarations = matchedDeclarations(
          dialog,
          phoneDialogCss,
          width,
          true
        );

        expect(declarations.some((style) => style.width === "100vw")).toBe(
          width <= 640
        );
      }

      const commandLabel = root.querySelector(
        "#command-menu-button"
      )?.textContent;

      if (surface === "settings" && width <= 640) {
        expect(commandLabel).toBeUndefined();
      } else {
        expect(commandLabel).toBe(
          width <= 640 ? "Commands" : "Commands · Ctrl+K"
        );
      }
    })
);

it.effect(
  "coarse pointer rules hide dialog hints but keep fine-pointer hints and every command",
  () =>
    Effect.gen(function* coarseHintPolicy() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/coarse-pointer.css");
      const root = yield* renderPhone(phoneDialogsFixture("command", 390, 844));

      const hints = root.querySelectorAll(
        "[data-command-trigger-hint], #keyboard-choices button > span:last-child, #keyboard-command-dialog > footer"
      );

      expect(hints.length).toBeGreaterThan(2);

      for (const hint of hints) {
        expect(
          matchedDeclarations(hint, css, 390, true).some(
            (style) => style.display === "none"
          )
        ).toBe(true);
        expect(
          matchedDeclarations(hint, css, 390, false).some(
            (style) => style.display === "none"
          )
        ).toBe(false);
      }

      for (const button of root.querySelectorAll("#keyboard-choices button")) {
        expect(
          matchedDeclarations(button, css, 390, true).some(
            (style) => style.display === "none"
          )
        ).toBe(false);
      }
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect.each(
  phoneDialogSurfaces.flatMap((surface) =>
    [390, 430].map((width) => ({ surface, width }))
  )
)(
  "every phone surface uses readable inputs and the editor keeps safe-area actions outside its scrolling body: %j",
  ({ surface, width }) =>
    Effect.gen(function* phoneControlPolicy() {
      const root = yield* renderPhone(phoneDialogsFixture(surface, width, 932));
      const dialog = root.querySelector(phoneDialogSelector(surface));
      expect(dialog).not.toBeNull();

      if (dialog === null) {
        return;
      }

      dialog.setAttribute("open", "");

      const inputs = dialog.querySelectorAll(
        "input:not([type='checkbox']):not([type='radio']), select, textarea"
      );

      expect(inputs.length).toBeGreaterThan(0);

      for (const input of inputs) {
        expect(
          matchedDeclarations(input, phoneDialogCss, width, true).some(
            (style) => style.fontSize === "16px"
          )
        ).toBe(true);
      }

      for (const target of dialog.querySelectorAll(
        'button, a[href], label:has(input[type="checkbox"], input[type="radio"])'
      )) {
        expect(
          matchedDeclarations(target, phoneDialogCss, width, true).some(
            (style) => style.minHeight === "44px"
          )
        ).toBe(true);
      }

      if (surface === "editor") {
        expect(
          dialog.querySelectorAll(
            "#event-startDate, #event-endDate, #event-startTime, #event-endTime"
          )
        ).toHaveLength(4);
        const footer = dialog.querySelector(".editor-footer");
        expect(footer).not.toBeNull();
        expect(dialog.querySelector(".editor-scroll")?.contains(footer)).toBe(
          false
        );

        if (footer !== null) {
          expect(
            matchedDeclarations(footer, phoneDialogCss, width, true).some(
              (style) => style.paddingBottom.includes("safe-area-inset-bottom")
            )
          ).toBe(true);
        }
      }
    })
);

it.effect.each([
  SettingsRoute.make({ page: "general" }),
  SettingsRoute.make({ page: "calendars" }),
  AccountSettingsRoute.make({ accountId: "work" }),
  SettingsRoute.make({ page: "notifications" }),
  SettingsRoute.make({ page: "conferencing" }),
  SettingsRoute.make({ page: "menu-bar" }),
])(
  "all Settings tabs give checkbox labels and interactive controls 44px phone targets: %j",
  (route) =>
    Effect.gen(function* settingsTapPolicy() {
      const base = phoneDialogsFixture("settings", 390, 844);

      const model = {
        ...base,
        desktop: { ...base.desktop, availability: "available" },
        route,
      } satisfies AppModel;

      const root = yield* renderPhone(model);
      const dialog = root.querySelector("#phone-settings-dialog");
      expect(dialog).not.toBeNull();

      if (dialog === null) {
        return;
      }

      const controls = [
        ...dialog.querySelectorAll(
          'button, a[href], label:has(input[type="checkbox"], input[type="radio"])'
        ),
      ];

      expect(controls.length).toBeGreaterThan(0);

      const targets = controls.map((target) => {
        const minimum = matchedDeclarations(
          target,
          phoneDialogCss,
          390,
          true
        ).some((style) => style.minHeight === "44px");

        expect(minimum).toBe(true);

        return {
          label: target.getAttribute("aria-label") ?? target.textContent,
          minimumHeight: 44,
          tag: target.tagName,
        };
      });

      for (const input of dialog.querySelectorAll('input[type="checkbox"]')) {
        expect(input.closest("label")).not.toBeNull();
      }

      const fs = yield* FileSystem.FileSystem;
      yield* fs.makeDirectory("../../.rat/phone-dialogs", { recursive: true });
      yield* publishFixtureArtifact(
        `../../.rat/phone-dialogs/settings-tap-scan-${route.page}.json`,
        `${JSON.stringify(
          {
            checkboxCount: dialog.querySelectorAll('input[type="checkbox"]')
              .length,
            evidence: "Parsed CSSRule stand-in scan; no browser geometry",
            page: route.page,
            targets,
            viewportWidth: 390,
          },
          null,
          2
        )}\n`
      );
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "actual phone route close buttons reach the existing calendar route",
  () =>
    Effect.sync(() => {
      for (const surface of ["settings", "search"] as const) {
        const messages: AppMessage[] = [];
        const model = phoneDialogsFixture(surface, 390, 844);

        Scene.scene(
          {
            update: (current: AppModel, message: AppMessage) => {
              messages.push(message);

              return { model: current };
            },
            view,
          },
          Scene.given(model),
          Scene.Mount.resolve(PrepareKeyboard, Message.KeyboardClose()),
          Scene.Mount.resolve(
            PrepareEditingDialogs,
            Message.EditingAction({
              action: EditorAction.cases.Cancel.make({}),
            })
          ),
          ...(surface === "search"
            ? [Scene.Mount.resolve(PrepareSearch, Message.Navigated())]
            : []),
          Scene.click(Scene.role("button", { name: `Close ${surface}` }))
        );

        const close = messages.at(-1);
        expect(close).toEqual(
          Message.RequestedRoute({
            replace: true,
            route: CalendarRoute.make({}),
          })
        );

        if (close !== undefined) {
          expect(update(model, close).model.route).toEqual(
            CalendarRoute.make({})
          );
        }
      }
    })
);

it.effect(
  "native phone route dismissal restores the connected Commands opener",
  () =>
    Effect.gen(function* routeFocusReturn() {
      const root = yield* renderPhone(
        phoneDialogsFixture("settings", 390, 844)
      );

      const opener = document.createElement("button");
      opener.id = "command-menu-button";
      opener.textContent = "Commands opener";
      root.prepend(opener);
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          document.body.append(root);
        }),
        () =>
          Effect.sync(() => {
            root.remove();
          })
      );

      const dialog = root.querySelector<HTMLDialogElement>(
        "#phone-settings-dialog"
      );

      expect(dialog).not.toBeNull();

      if (dialog === null) {
        return;
      }

      installPhoneDialogStandIn(dialog);
      opener.focus();
      const messages: PhoneRouteMessage[] = [];
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          attachPhoneRouteSheets(root, (message) => {
            messages.push(message);
          })
        ),
        (dispose) => Effect.sync(dispose)
      );
      expect(dialog.open).toBe(true);
      const close = dialog.querySelector<HTMLButtonElement>("button");
      expect(document.activeElement).toBe(close);
      dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(
        Message.RequestedRoute({ replace: true, route: CalendarRoute.make({}) })
      );
      yield* Effect.callback<boolean>((resume) => {
        const observed = new MutationObserver(() => {
          observed.disconnect();
          resume(Effect.succeed(true));
        });

        observed.observe(root, { childList: true, subtree: true });
        dialog.remove();

        return Effect.sync(() => {
          observed.disconnect();
        });
      });
      expect(document.activeElement).toBe(opener);
    })
);

it.effect(
  "the phone Upcoming sheet has one heading without its repeated body label",
  () =>
    Effect.gen(function* upcomingLabel() {
      const root = yield* renderPhone(phoneShellFixture(390, 844, "upcoming"));
      expect(root.querySelector(".phone-panel-header h2")?.textContent).toBe(
        "Upcoming meeting"
      );
      expect(root.querySelector(".upcoming-label")).toBeNull();
      expect(root.querySelector(".upcoming-title")?.textContent).toBeTruthy();
    })
);

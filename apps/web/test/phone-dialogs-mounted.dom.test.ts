import { expect, it } from "@effect/vitest";
import { Effect, Option, Predicate, Queue, Stream } from "effect";
import { Runtime, Subscription } from "foldkit";
import { vi } from "vitest";

import { Message, Model, update } from "../src/client/app.js";
import type { AppMessage, AppModel } from "../src/client/app.js";
import { FocusSearch } from "../src/client/search/commands.js";
import { view } from "../src/features/app.js";
import { unusedBrowserLayers } from "./browser-runtime-fixture.js";
import { phoneShellFixture } from "./phone-shell-fixture.js";

const openDialogStandIn = function openDialogStandIn(
  this: HTMLDialogElement
): void {
  this.open = true;
  this.querySelector<HTMLElement>("button, input, select, textarea")?.focus();
};

const closeDialogStandIn = function closeDialogStandIn(
  this: HTMLDialogElement
): void {
  this.open = false;
};

const mountedState = (read: () => boolean) =>
  Effect.callback<boolean>((resume) => {
    const inspect = () => {
      if (read()) {
        resume(Effect.succeed(true));
      }
    };

    const observer = new MutationObserver(inspect);
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    document.addEventListener("focusin", inspect, true);
    inspect();

    return Effect.sync(() => {
      observer.disconnect();
      document.removeEventListener("focusin", inspect, true);
    });
  });

it.effect.each(["connected-opener", "command-menu-removal"] as const)(
  "real mounted Search scheduling focuses its query and restores a connected opener or Commands: %s",
  (path) =>
    Effect.gen(function* mountedSearchFocus() {
      const inbound = yield* Queue.unbounded<AppMessage>();
      const seen: AppMessage[] = [];
      const heldCommands: string[] = [];
      let current = phoneShellFixture(390, 844);

      const environment = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const element = document.createElement("div");
          element.id = "phone-dialog-runtime";
          document.body.append(element);
          vi.spyOn(
            document.documentElement,
            "clientWidth",
            "get"
          ).mockReturnValue(390);
          vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(
            390
          );
          vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(
            390
          );
          vi.spyOn(
            HTMLElement.prototype,
            "clientHeight",
            "get"
          ).mockReturnValue(699);
          vi.stubGlobal(
            "ResizeObserver",
            class {
              observe = vi.fn();
              unobserve = vi.fn();
              disconnect = vi.fn();
            }
          );
          vi.stubGlobal("matchMedia", () => ({
            addEventListener: vi.fn(),
            matches: true,
            removeEventListener: vi.fn(),
          }));
          // oxlint-disable-next-line typescript/unbound-method -- The dialog focus stand-in calls the saved method with its original HTMLElement receiver.
          const { focus } = HTMLElement.prototype;
          vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(
            function nativeDialogFocus(
              this: HTMLElement,
              options?: FocusOptions
            ) {
              if (this.closest("dialog:not([open])") === null) {
                focus.call(this, options);
              }
            }
          );

          const dialogs = new Map(
            ["showModal", "close"].map((name) => [
              name,
              Object.getOwnPropertyDescriptor(
                HTMLDialogElement.prototype,
                name
              ),
            ])
          );

          Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
            configurable: true,
            value: openDialogStandIn,
          });
          Object.defineProperty(HTMLDialogElement.prototype, "close", {
            configurable: true,
            value: closeDialogStandIn,
          });

          return { dialogs, element };
        }),
        ({ dialogs, element }) =>
          Effect.sync(() => {
            document.querySelector("#phone-dialog-runtime")?.remove();
            element.remove();
            vi.restoreAllMocks();
            vi.unstubAllGlobals();

            for (const [name, descriptor] of dialogs) {
              if (descriptor === undefined) {
                Reflect.deleteProperty(HTMLDialogElement.prototype, name);
              } else {
                Object.defineProperty(
                  HTMLDialogElement.prototype,
                  name,
                  descriptor
                );
              }
            }
          })
      );

      const { element: container } = environment;

      const program = Runtime.makeElement({
        Model,
        container,
        devTools: false,
        init: () => ({ model: current }),
        resources: unusedBrowserLayers,
        subscriptions: Subscription.make<AppModel, AppMessage>()(() => ({
          input: Subscription.persistentEntry(Stream.fromQueue(inbound)),
        })),
        update: (model, message) => {
          const result = update(model, message);
          current = result.model;
          seen.push(message);
          const commands = result.commands ?? [];
          heldCommands.push(
            ...commands
              .filter((command) => command.name !== "FocusSearch")
              .map((command) => command.name)
          );

          return {
            commands: commands.some((command) => command.name === "FocusSearch")
              ? [FocusSearch()]
              : [],
            model: result.model,
          };
        },
        view: (model, h) =>
          h.div([h.Id("phone-dialog-runtime")], [view(model, h).body]),
      });

      yield* Effect.acquireRelease(
        Effect.sync(() => Runtime.embed(program)),
        (mounted) =>
          Effect.sync(() => {
            mounted.dispose();
          })
      );
      yield* mountedState(
        () =>
          document.querySelector(
            "#phone-dialog-runtime #phone-context-button"
          ) !== null
      );

      const root = yield* Effect.fromNullishOr(
        document.querySelector<HTMLElement>("#phone-dialog-runtime")
      );

      const opener = yield* Effect.fromNullishOr(
        root.querySelector<HTMLButtonElement>(
          path === "connected-opener"
            ? "#phone-context-button"
            : "#command-menu-button"
        )
      );

      opener.focus();

      if (path === "connected-opener") {
        Queue.offerUnsafe(
          inbound,
          Message.SearchOpened({ query: Option.none() })
        );
      } else {
        opener.click();
        yield* mountedState(
          () =>
            root.querySelector<HTMLDialogElement>("#keyboard-command-dialog")
              ?.open === true
        );

        const search = yield* Effect.fromNullishOr(
          root.querySelector<HTMLButtonElement>("#command-search-events")
        );

        search.click();
      }

      yield* mountedState(
        () =>
          root.querySelector<HTMLDialogElement>("#phone-search-dialog")
            ?.open === true && document.activeElement?.id === "search-query"
      );
      expect(root.querySelector("#keyboard-command-dialog")).toBeNull();
      expect(current.route._tag).toBe("Search");
      expect(
        seen.some(
          (message) =>
            Predicate.isTagged(message, "SearchOpened") ||
            Predicate.isTagged(message, "KeyboardPick")
        )
      ).toBe(true);

      const close = yield* Effect.fromNullishOr(
        root.querySelector<HTMLButtonElement>("#phone-search-dialog-close")
      );

      close.click();
      yield* mountedState(
        () =>
          root.querySelector("#phone-search-dialog") === null &&
          Predicate.isTagged(current.route, "Calendar")
      );
      expect(opener.isConnected).toBe(true);
      expect(document.activeElement).toBe(opener);
      expect(heldCommands).toContain("NavigateRoute");
    })
);

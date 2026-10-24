import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Option, Schema, Stream } from "effect";
import { Runtime } from "foldkit";
import type { HtmlBuilder } from "foldkit/html";
import { UrlRequest } from "foldkit/navigation";
import { fromString } from "foldkit/url";
import { vi } from "vitest";

import {
  Message,
  Model,
  onUrlChange,
  onUrlRequest,
  update,
} from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import {
  BackRoute,
  InitializeRouteHistory,
  FollowRouteRequest,
  NavigateRoute,
  historyPosition,
} from "../src/client/routing.js";
import { view } from "../src/features/app.js";
import {
  AccountSettingsRoute,
  CalendarRoute,
  Route,
  SettingsRoute,
} from "../src/layout/route.js";
import { unusedBrowserLayers } from "./browser-runtime-fixture.js";
import { fixtureModel } from "./fixture.js";

const mountedAnchorRoot = () =>
  document.querySelector("#calendars-redirect-anchor-runtime");

const anchorView = (model: AppModel, h: HtmlBuilder<AppMessage>) => ({
  body: h.div(
    [h.Id("calendars-redirect-anchor-runtime")],
    [view(model, h).body]
  ),
  title: "Calendar",
});

const showDialog = function showDialog(this: HTMLDialogElement): void {
  this.open = true;
};

const closeDialog = function closeDialog(this: HTMLDialogElement): void {
  this.open = false;
};

const mountedRoute = (ready: () => boolean) =>
  Effect.callback<boolean>((resume) => {
    const inspect = () => {
      if (ready()) {
        resume(Effect.succeed(true));
      }
    };

    const observer = new MutationObserver(inspect);
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    inspect();

    return Effect.sync(() => {
      observer.disconnect();
    });
  });

it.effect.each([false, true])(
  "an actual Foldkit Calendars anchor click makes one resolved history push and Back returns to General (phone=%s)",
  (phone) =>
    Effect.gen(function* realAnchorHistory() {
      const width = phone ? 390 : 1440;
      const container = document.createElement("div");
      container.id = "calendars-redirect-anchor-runtime";
      document.body.append(container);

      const dialogs = new Map(
        ["showModal", "close"].map((name) => [
          name,
          Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name),
        ])
      );

      Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
        configurable: true,
        value: showDialog,
      });
      Object.defineProperty(HTMLDialogElement.prototype, "close", {
        configurable: true,
        value: closeDialog,
      });
      vi.stubGlobal("innerWidth", width);
      vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(
        width
      );
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          container.remove();
          window.history.replaceState(null, "", "/");
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
      window.history.replaceState(null, "", "/settings/general");
      yield* InitializeRouteHistory().effect;
      const base = fixtureModel();

      const initial = update(
        { ...base, route: SettingsRoute.make({ page: "general" }) },
        Message.MeasuredShellViewport({ width })
      ).model;

      let current = initial;

      const program = Runtime.makeApplication({
        Model,
        container,
        devTools: false,
        init: () => ({ model: initial }),
        resources: unusedBrowserLayers,
        routing: { onUrlChange, onUrlRequest },
        update: (model: AppModel, message: AppMessage) => {
          const result = update(model, message);
          current = result.model;

          return {
            commands: (result.commands ?? []).flatMap<
              | ReturnType<typeof NavigateRoute>
              | ReturnType<typeof FollowRouteRequest>
              | ReturnType<typeof BackRoute>
            >((command) => {
              if (command.name === "NavigateRoute") {
                return [
                  NavigateRoute(
                    Schema.decodeUnknownSync(
                      Schema.Struct({ replace: Schema.Boolean, route: Route })
                    )(command.args)
                  ),
                ];
              }

              if (command.name === "FollowRouteRequest") {
                return [
                  FollowRouteRequest(
                    Schema.decodeUnknownSync(
                      Schema.Struct({ request: UrlRequest })
                    )(command.args)
                  ),
                ];
              }

              if (command.name === "BackRoute") {
                return [BackRoute()];
              }

              return [];
            }),
            model: result.model,
          };
        },
        view: anchorView,
      });

      yield* Effect.acquireRelease(
        Effect.sync(() => Runtime.embed(program)),
        (mounted) =>
          Effect.sync(() => {
            mounted.dispose();
          })
      );
      yield* mountedRoute(
        () =>
          mountedAnchorRoot()?.querySelector(".settings-content h1")
            ?.textContent === "General" &&
          (!phone ||
            mountedAnchorRoot()?.querySelector<HTMLDialogElement>(
              "#phone-settings-dialog"
            )?.open === true)
      );
      const push = vi.spyOn(window.history, "pushState");
      const replace = vi.spyOn(window.history, "replaceState");

      const anchor = mountedAnchorRoot()?.querySelector<HTMLAnchorElement>(
        '.settings-nav a[href="/settings/calendars"]'
      );

      expect(
        anchor,
        "Actual settings sidebar Calendars anchor must be mounted"
      ).not.toBeNull();
      anchor?.click();
      yield* mountedRoute(
        () =>
          window.location.pathname === "/settings/calendar/work" &&
          mountedAnchorRoot()
            ?.querySelector('.settings-account-nav[aria-current="page"]')
            ?.getAttribute("href") === "/settings/calendar/work"
      );
      expect(
        push.mock.calls.map((call) => call[2]),
        "Anchor must push the resolved target, never the alias"
      ).toEqual(["/settings/calendar/work"]);
      expect(
        replace,
        "Known-account anchor must not need a second replacement write"
      ).not.toHaveBeenCalled();
      expect(historyPosition()).toBe(1);
      expect(current.route).toEqual(
        AccountSettingsRoute.make({ accountId: "work" })
      );

      if (phone) {
        expect(
          mountedAnchorRoot()?.querySelector<HTMLDialogElement>(
            "#phone-settings-dialog"
          )?.open
        ).toBe(true);
      }

      const popped = yield* Stream.fromEventListener<PopStateEvent>(
        window,
        "popstate"
      ).pipe(Stream.take(1), Stream.runDrain, Effect.forkChild);

      yield* BackRoute().effect;
      yield* Fiber.join(popped);
      yield* mountedRoute(
        () =>
          window.location.pathname === "/settings/general" &&
          mountedAnchorRoot()?.querySelector(".settings-content h1")
            ?.textContent === "General"
      );
      expect(current.route).toEqual(SettingsRoute.make({ page: "general" }));
      expect(historyPosition()).toBe(0);

      if (phone) {
        expect(
          mountedAnchorRoot()?.querySelector<HTMLDialogElement>(
            "#phone-settings-dialog"
          )?.open
        ).toBe(true);
      }
    }).pipe(Effect.scoped)
);

it.effect.each([false, true])(
  "the actual Calendars history replacement and phone back return to Calendar without a redirect loop (phone=%s)",
  (phone) =>
    Effect.gen(function* redirectHistory() {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          window.history.replaceState(null, "", "/");
        })
      );
      window.history.replaceState(null, "", "/");
      yield* InitializeRouteHistory().effect;
      const base = fixtureModel();

      const model = phone
        ? update(base, Message.MeasuredShellViewport({ width: 390 })).model
        : base;

      const entered = update(
        model,
        Message.RequestedRoute({
          replace: false,
          route: SettingsRoute.make({ page: "calendars" }),
        })
      );

      yield* Effect.forEach(
        (entered.commands ?? []).filter(
          (command) => command.name === "NavigateRoute"
        ),
        (command) =>
          NavigateRoute(
            Schema.decodeUnknownSync(
              Schema.Struct({ replace: Schema.Boolean, route: Route })
            )(command.args)
          ).effect
      );
      expect(
        window.location.pathname,
        "Actual history must land directly on the first account"
      ).toBe("/settings/calendar/work");
      expect(historyPosition(), "Redirect must not add a bounce entry").toBe(0);
      const current = Option.getOrThrow(fromString(window.location.href));

      const settled = update(
        entered.model,
        Message.BrowserUrlChanged({ url: current })
      );

      expect(settled.model.route).toEqual(
        AccountSettingsRoute.make({ accountId: "work" })
      );
      expect(
        settled.commands?.some((command) => command.name === "NavigateRoute") ??
          false
      ).toBe(false);
      const back = update(settled.model, Message.RequestedRouteBack());
      expect(
        back.commands?.filter((command) => command.name === "BackRoute")
      ).toHaveLength(1);
      yield* BackRoute().effect;
      expect(window.location.pathname).toBe("/");
      expect(historyPosition()).toBe(0);

      const closed = update(
        back.model,
        Message.BrowserUrlChanged({
          url: Option.getOrThrow(fromString(window.location.href)),
        })
      );

      expect(closed.model.route).toEqual(CalendarRoute.make({}));
      expect(closed.model.phoneShell.mode).toBe("closed");
      expect(
        closed.commands?.some((command) => command.name === "NavigateRoute") ??
          false
      ).toBe(false);
    }).pipe(Effect.scoped)
);

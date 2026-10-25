import { Effect, Layer, Option, Queue, Schema } from "effect";
import { Runtime } from "foldkit";
import type { HtmlBuilder } from "foldkit/html";
import { UrlRequest } from "foldkit/navigation";
import { vi } from "vitest";

import { Model, onUrlChange, onUrlRequest, update } from "../src/client/app.js";
import type { AppMessage, AppModel } from "../src/client/app.js";
import { EditingRuntime } from "../src/client/editing/runtime.js";
import {
  BackRoute,
  FollowRouteRequest,
  InitializeRouteHistory,
  NavigateRoute,
} from "../src/client/routing.js";
import { RunProfileRequest } from "../src/client/settings/profile/commands.js";
import { ProfileWork } from "../src/client/settings/profile/model.js";
import { ProfilePort } from "../src/client/settings/profile/port.js";
import type { ProfilePortService } from "../src/client/settings/profile/port.js";
import { subscriptions } from "../src/client/subscriptions.js";
import { view } from "../src/features/app.js";
import { printRoute, Route } from "../src/layout/route.js";
import { unusedBrowserLayers } from "./browser-runtime-fixture.js";

export const profileRuntimeRoot = () =>
  document.querySelector("#profile-test-runtime");

const profileView = (model: AppModel, h: HtmlBuilder<AppMessage>) => ({
  body: h.div([h.Id("profile-test-runtime")], [view(model, h).body]),
  title: "Profile test",
});

const showDialog = function showDialog(this: HTMLDialogElement): void {
  this.open = true;
};

const closeDialog = function closeDialog(this: HTMLDialogElement): void {
  this.open = false;
};

export const profileDomReady = (ready: () => boolean) =>
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

export const mountProfileRuntime = Effect.fn("test.mountProfileRuntime")(
  function* mountProfileRuntime(initial: AppModel, port: ProfilePortService) {
    const container = document.createElement("div");
    container.id = "profile-test-runtime";
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
    vi.stubGlobal("innerWidth", initial.calendar.viewportWidth);
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(
      initial.calendar.viewportWidth
    );
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        profileRuntimeRoot()?.remove();
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
    window.history.replaceState(null, "", printRoute(initial.route));
    yield* InitializeRouteHistory().effect;
    let current = initial;
    const messages = yield* Queue.unbounded<AppMessage>();

    const resources = Layer.mergeAll(
      unusedBrowserLayers,
      Layer.succeed(ProfilePort, port),
      Layer.succeed(
        EditingRuntime,
        EditingRuntime.of({
          connect: () => Effect.die("Profile seam must not connect editing"),
          dispatch: () => Effect.die("Profile seam must not dispatch editing"),
        })
      )
    );

    const program = Runtime.makeApplication({
      Model,
      container,
      devTools: false,
      init: () => ({ model: initial }),
      resources,
      routing: { onUrlChange, onUrlRequest },
      subscriptions: { profileUnload: subscriptions.profileUnload },
      update: (model: AppModel, message: AppMessage) => {
        const result = update(model, message);
        current = result.model;
        Queue.offerUnsafe(messages, message);

        return {
          commands: (result.commands ?? []).flatMap<
            | ReturnType<typeof NavigateRoute>
            | ReturnType<typeof FollowRouteRequest>
            | ReturnType<typeof BackRoute>
            | ReturnType<typeof RunProfileRequest>
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

            if (command.name === "RunProfileRequest") {
              return [
                RunProfileRequest(
                  Schema.decodeUnknownSync(
                    Schema.Struct({
                      personId: Schema.String,
                      sequence: Schema.Int,
                      work: ProfileWork,
                    })
                  )(command.args)
                ),
              ];
            }

            return [];
          }),
          model: result.model,
        };
      },
      view: profileView,
    });

    yield* Effect.acquireRelease(
      Effect.sync(() => Runtime.embed(program)),
      (mounted) =>
        Effect.sync(() => {
          mounted.dispose();
        })
    );
    yield* profileDomReady(
      () =>
        profileRuntimeRoot()?.querySelector(".settings-content")
          ?.isConnected === true
    );

    return { current: () => current, messages };
  }
);

export const profileInput = (): HTMLInputElement =>
  Option.getOrThrow(
    Option.fromNullishOr(
      profileRuntimeRoot()?.querySelector<HTMLInputElement>("#profile-name")
    )
  );

export const profileButton = (name: string): HTMLButtonElement =>
  Option.getOrThrow(
    Option.fromNullishOr(
      [
        ...(profileRuntimeRoot()?.querySelectorAll<HTMLButtonElement>(
          "button"
        ) ?? []),
      ].find((button) => button.textContent === name)
    )
  );

export const editProfileInput = (value: string): void => {
  const input = profileInput();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

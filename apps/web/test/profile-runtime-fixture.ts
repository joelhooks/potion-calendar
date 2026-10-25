import { SessionSnapshot } from "@calendar/core/contracts";
import { Effect, Exit, Layer, Option, Queue, Schema } from "effect";
import { Port, Runtime, Subscription } from "foldkit";
import type { HtmlBuilder } from "foldkit/html";
import { UrlRequest } from "foldkit/navigation";
import { vi } from "vitest";

import {
  Message,
  Model,
  onUrlChange,
  onUrlRequest,
  update,
} from "../src/client/app.js";
import type { AppMessage, AppModel } from "../src/client/app.js";
import { EditingRuntime } from "../src/client/editing/runtime.js";
import { LiveNotice } from "../src/client/live/protocol.js";
import {
  BackRoute,
  FollowRouteRequest,
  InitializeRouteHistory,
  NavigateRoute,
} from "../src/client/routing.js";
import { RunAccountDeletion } from "../src/client/settings/delete-account/commands.js";
import { AccountDeletionPort } from "../src/client/settings/delete-account/port.js";
import type { AccountDeletionPortService } from "../src/client/settings/delete-account/port.js";
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

const profileHostPorts = {
  inbound: {
    live: Port.inbound(
      Schema.Struct({ notice: LiveNotice, personId: Schema.String })
    ),
    session: Port.inbound(SessionSnapshot),
  },
};

const profileTestSubscriptions = Subscription.make<AppModel, AppMessage>()(
  () => ({
    live: Port.subscriptionEntry(
      profileHostPorts.inbound.live,
      ({ personId, notice }) => Message.ReceivedLive({ notice, personId })
    ),
    session: Port.subscriptionEntry(
      profileHostPorts.inbound.session,
      (snapshot) => Message.ReceivedSession({ snapshot })
    ),
  })
);

const unusedAccountDeletionPort: AccountDeletionPortService = {
  remove: () => Effect.die("Profile seam must not delete an account"),
};

const showDialog = function showDialog(this: HTMLDialogElement): void {
  this.open = true;
};

const closeDialog = function closeDialog(this: HTMLDialogElement): void {
  this.open = false;
};

export const profileDomReady = (ready: () => boolean) =>
  Effect.callback<boolean>((resume) => {
    const observer = new MutationObserver((_, currentObserver) => {
      if (ready()) {
        currentObserver.disconnect();
        resume(Effect.succeed(true));
      }
    });

    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    });

    if (ready()) {
      observer.disconnect();
      resume(Effect.succeed(true));
    }

    return Effect.sync(() => {
      observer.disconnect();
    });
  });

export const mountProfileRuntime = Effect.fn("test.mountProfileRuntime")(
  function* mountProfileRuntime(
    initial: AppModel,
    port: ProfilePortService,
    deletionPort: AccountDeletionPortService = unusedAccountDeletionPort
  ) {
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
      Layer.succeed(AccountDeletionPort, deletionPort),
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
      ports: profileHostPorts,
      resources,
      routing: { onUrlChange, onUrlRequest },
      subscriptions: {
        live: profileTestSubscriptions.live,
        profileUnload: subscriptions.profileUnload,
        session: profileTestSubscriptions.session,
      },
      update: (model: AppModel, message: AppMessage) => {
        const result = update(model, message);
        current = result.model;
        Queue.offerUnsafe(messages, message);

        return {
          commands: (result.commands ?? []).flatMap<
            | ReturnType<typeof NavigateRoute>
            | ReturnType<typeof FollowRouteRequest>
            | ReturnType<typeof BackRoute>
            | ReturnType<typeof RunAccountDeletion>
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

            if (command.name === "RunAccountDeletion") {
              return [
                RunAccountDeletion(
                  Schema.decodeUnknownSync(
                    Schema.Struct({
                      personId: Schema.String,
                      proof: Schema.String,
                      sequence: Schema.Int,
                    })
                  )(command.args)
                ),
              ];
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

    const mounted = yield* Effect.acquireRelease(
      Effect.sync(() => Runtime.embed(program)),
      (handle) =>
        Effect.sync(() => {
          handle.dispose();
        })
    );

    yield* profileDomReady(
      () =>
        profileRuntimeRoot()?.querySelector(".settings-content")
          ?.isConnected === true
    );

    const receiveSession = Effect.fn("test.receiveProfileSession")(
      function* receiveProfileSession(
        snapshot: typeof SessionSnapshot.Encoded
      ) {
        const sent = yield* Effect.sync(() =>
          mounted.ports.session.send(snapshot)
        );

        if (Exit.isFailure(sent)) {
          return yield* Effect.failCause(sent.cause);
        }

        return yield* Effect.void;
      }
    );

    const receiveLive = Effect.fn("test.receiveProfileLive")(
      function* receiveProfileLive(
        personId: string,
        notice: typeof LiveNotice.Type
      ) {
        const sent = yield* Effect.sync(() =>
          mounted.ports.live.send({ notice, personId })
        );

        if (Exit.isFailure(sent)) {
          return yield* Effect.failCause(sent.cause);
        }

        return yield* Effect.void;
      }
    );

    return { current: () => current, messages, receiveLive, receiveSession };
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

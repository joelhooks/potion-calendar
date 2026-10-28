// oxlint-disable typescript/promise-function-async -- Faithful preload Promise fakes supply native results without a second Effect runtime.
import { AboutReply } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Schema } from "effect";
import { Scene } from "foldkit/test";
import { vi } from "vitest";

import { initialModel, Message, update } from "../src/client/app.js";
import { RequestDesktopAbout } from "../src/client/desktop/about.js";
import {
  DesktopNotice,
  DesktopOutcome,
  DesktopRequest,
} from "../src/client/desktop/model.js";
import { runDesktopRequest } from "../src/client/desktop/runtime.js";
import { DispatchEditing } from "../src/client/editing/commands.js";
import { PrepareEditingDialogs } from "../src/client/editing/dialog-mount.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { commandChoices } from "../src/client/keyboard/choices.js";
import { PrepareKeyboard } from "../src/client/keyboard/mount.js";
import { view } from "../src/features/app.js";
import { SettingsRoute } from "../src/layout/route.js";
import {
  aboutBrowserBridge,
  aboutCommandFixture,
  installAboutBridge,
} from "./about-command-fixture.js";
import { commandCatalogSettings } from "./command-catalog-fixture.js";
import { unusedIcsRootLayers } from "./desktop-ics-fixture.js";
import { upcomingNow, upcomingSession } from "./upcoming-fixture.js";

const anotherSession = {
  accounts: [
    {
      disconnected: false,
      email: "other@example.test",
      id: "about-other-account",
    },
  ],
  user: {
    email: "other@example.test",
    id: "about-other-person",
    name: "Other person",
  },
};

it.effect(
  "desktop Finished before ReceivedSession retains About through sign-in, sign-out and person switch",
  () =>
    Effect.sync(() => {
      let model = initialModel(upcomingNow, "UTC");
      ({ model } = update(
        model,
        Message.ReceivedDesktop({
          notice: DesktopNotice.cases.Finished.make({
            canShowAbout: true,
            outcome: DesktopOutcome.cases.Ready.make({
              error: Option.none(),
              settings: commandCatalogSettings(),
            }),
            request: 0,
          }),
        })
      ));
      expect(model.desktop.canShowAbout).toBe(true);

      for (const snapshot of [
        upcomingSession,
        null,
        upcomingSession,
        anotherSession,
      ]) {
        ({ model } = update(model, Message.ReceivedSession({ snapshot })));
        expect(model.person).toEqual(
          snapshot === null ? Option.none() : Option.some(snapshot.user.id)
        );
        ({ model } = update(model, Message.KeyboardAction({ id: "commands" })));
        ({ model } = update(model, Message.KeyboardQuery({ query: "About" })));
        expect(
          commandChoices(model).find((entry) => entry.id === "about"),
          "desktop Finished before ReceivedSession must retain the Mac About command"
        ).toMatchObject({
          disabled: false,
          keys: [],
          section: "Settings & help",
          title: "About",
        });
      }
    })
);

it.effect.prop(
  "About shell capability presence survives both session arrival orders, sign-out and person changes",
  {
    readFirst: Arbitrary.schema(Schema.Boolean),
    shell: Arbitrary.schema(Schema.Literals(["mac", "legacy", "web"])),
  },
  ({ readFirst, shell }) =>
    Effect.sync(() => {
      let model = initialModel(upcomingNow, "UTC");

      const outcome =
        shell === "web"
          ? DesktopOutcome.cases.Unavailable.make({})
          : DesktopOutcome.cases.Ready.make({
              error: Option.none(),
              settings: commandCatalogSettings(),
            });

      const base = { outcome, request: 0 };

      const notice = DesktopNotice.cases.Finished.make(
        shell === "mac" ? { ...base, canShowAbout: true } : base
      );

      const read = Message.ReceivedDesktop({ notice });
      const signedIn = Message.ReceivedSession({ snapshot: upcomingSession });

      for (const message of readFirst ? [read, signedIn] : [signedIn, read]) {
        ({ model } = update(model, message));
      }

      for (const snapshot of [
        null,
        upcomingSession,
        anotherSession,
        upcomingSession,
      ]) {
        ({ model } = update(model, Message.ReceivedSession({ snapshot })));
        expect(model.person).toEqual(
          snapshot === null ? Option.none() : Option.some(snapshot.user.id)
        );
        expect(Object.hasOwn(model.desktop, "canShowAbout")).toBe(
          shell === "mac"
        );
        expect(model.desktop.canShowAbout).toBe(
          shell === "mac" ? true : undefined
        );
        ({ model } = update(model, Message.KeyboardAction({ id: "commands" })));
        ({ model } = update(model, Message.KeyboardQuery({ query: "About" })));
        expect(
          commandChoices(model).some((entry) => entry.id === "about"),
          "session receipts must preserve Mac About and omit it for legacy and web shells"
        ).toBe(shell === "mac");
      }
    })
);

it.effect("Mac command menu offers About in Settings & help", () =>
  Effect.sync(() => {
    const choice = commandChoices(aboutCommandFixture()).find(
      (entry) => entry.id === "about"
    );

    expect(
      choice,
      "Mac About capability must offer the native command"
    ).toMatchObject({
      disabled: false,
      keys: [],
      section: "Settings & help",
      title: "About",
    });
  })
);

it.effect("web command menu never offers About", () =>
  Effect.sync(() => {
    const model = aboutCommandFixture("web");
    expect(
      commandChoices(model).some((entry) => entry.id === "about"),
      "web command menu never offers About"
    ).toBe(false);
    expect(
      update(model, Message.RequestedDesktopAbout()).commands ?? []
    ).toEqual([]);
    expect(
      update(model, Message.KeyboardPick({ id: "about" })).commands ?? []
    ).toEqual([]);
  })
);

it.effect.each(["legacy", "unknown", "unavailable"] as const)(
  "%s desktop applicability omits About rather than disabling it",
  (kind) =>
    Effect.sync(() => {
      const base = aboutCommandFixture("legacy");

      const model =
        kind === "legacy"
          ? base
          : {
              ...base,
              desktop: {
                ...base.desktop,
                availability: kind,
                canShowAbout: true,
              },
            };

      expect(commandChoices(model).some((entry) => entry.id === "about")).toBe(
        false
      );
      expect(
        update(model, Message.RequestedDesktopAbout()).commands ?? []
      ).toEqual([]);
    })
);

it.effect(
  "the actual About option dispatches its named root command and closes the menu",
  () =>
    Effect.sync(() => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...aboutCommandFixture(),
          route: SettingsRoute.make({ page: "menu-bar" }),
        }),
        Scene.Mount.resolve(PrepareKeyboard, Message.KeyboardClose()),
        Scene.Mount.resolve(
          PrepareEditingDialogs,
          Message.EditingAction({ action: EditorAction.cases.Cancel.make({}) })
        ),
        Scene.Command.resolve(DispatchEditing, Message.DispatchedEditing()),
        Scene.click(Scene.selector("#command-menu-button")),
        Scene.type(Scene.selector("#keyboard-query"), "About"),
        Scene.expect(Scene.selector("#command-about")).toExist(),
        Scene.click(Scene.selector("#command-about")),
        Scene.Command.resolve(
          RequestDesktopAbout,
          Message.ReceivedDesktopAbout({
            reply: AboutReply.cases.Requested.make({ version: 1 }),
          })
        ),
        Scene.expect(Scene.selector("#command-about")).toBeAbsent()
      );
    })
);

it.effect(
  "root About discovers the real optional bridge, invokes once and leaves preferences and provider state untouched",
  () =>
    Effect.gen(function* rootAbout() {
      const calls: { readonly version: 1 }[] = [];

      const bridge = aboutBrowserBridge(
        // oxlint-disable-next-line typescript/promise-function-async -- The faithful optional preload stand-in returns its native request acknowledgement directly.
        (request) => {
          calls.push(request);

          return Promise.resolve(
            AboutReply.cases.Requested.make({ version: 1 })
          );
        }
      );

      yield* installAboutBridge(bridge);

      const network = yield* Effect.acquireRelease(
        Effect.sync(() =>
          vi.spyOn(globalThis, "fetch").mockImplementation(() => {
            throw new Error("About must not make provider writes");
          })
        ),
        (spy) =>
          Effect.sync(() => {
            spy.mockRestore();
          })
      );

      const base = aboutCommandFixture("legacy");

      const notice = yield* runDesktopRequest(
        DesktopRequest.cases.Read.make({ request: base.desktop.request }),
        Option.some(bridge)
      );

      const { model } = update(base, Message.ReceivedDesktop({ notice }));
      expect(model.desktop.canShowAbout).toBe(true);
      const picked = update(model, Message.KeyboardPick({ id: "about" }));
      expect(picked.model.keyboard.screen).toBe("closed");
      expect(picked.commands?.map((command) => command.name)).toEqual([
        "RequestDesktopAbout",
      ]);
      const command = picked.commands?.[0];
      expect(command).toBeDefined();

      if (command === undefined) {
        return;
      }

      const receipt = yield* command.effect.pipe(
        Effect.provide(unusedIcsRootLayers)
      );

      const completed = update(picked.model, receipt).model;
      expect(calls).toEqual([{ version: 1 }]);
      expect(completed.desktop.settings).toEqual(model.desktop.settings);
      expect(completed.desktop.request).toBe(model.desktop.request);
      expect(completed.calendar).toEqual(model.calendar);
      expect(completed.editing).toEqual(model.editing);
      expect(network).not.toHaveBeenCalled();
    })
);

it.effect(
  "a bridge withdrawn after menu projection refuses a stale command with zero IPC",
  () =>
    Effect.gen(function* staleAbout() {
      let calls = 0;
      yield* installAboutBridge(
        aboutBrowserBridge(
          // oxlint-disable-next-line typescript/promise-function-async -- A withdrawn native Promise stand-in must never receive a stale About invocation.
          () => {
            calls += 1;

            return Promise.resolve(
              AboutReply.cases.Requested.make({ version: 1 })
            );
          }
        )
      );
      Reflect.deleteProperty(window, "potionDesktop");
      const model = aboutCommandFixture();
      const picked = update(model, Message.KeyboardPick({ id: "about" }));
      const command = picked.commands?.[0];
      expect(command).toBeDefined();

      if (command === undefined) {
        return;
      }

      const receipt = yield* command.effect.pipe(
        Effect.provide(unusedIcsRootLayers)
      );

      expect(receipt).toEqual(
        Message.ReceivedDesktopAbout({
          reply: AboutReply.cases.Refused.make({
            reason: "unsupported",
            version: 1,
          }),
        })
      );
      const completed = update(picked.model, receipt).model;
      expect(completed.desktop.settings).toEqual(model.desktop.settings);
      expect(completed.calendar).toEqual(model.calendar);
      expect(completed.editing).toEqual(model.editing);
      expect(calls).toBe(0);
    })
);

it.effect(
  "native About failures are typed and never retried or projected as visible",
  () =>
    Effect.gen(function* failedAbout() {
      let calls = 0;
      yield* installAboutBridge(
        aboutBrowserBridge(
          // oxlint-disable-next-line typescript/promise-function-async -- A faithful rejected native Promise proves one attempted IPC request without another runtime.
          () => {
            calls += 1;

            return Promise.reject(new Error("private transport detail"));
          }
        )
      );
      const model = aboutCommandFixture();

      const command = update(model, Message.KeyboardPick({ id: "about" }))
        .commands?.[0];

      if (command === undefined) {
        throw new Error("Missing About command");
      }

      const receipt = yield* command.effect.pipe(
        Effect.provide(unusedIcsRootLayers)
      );

      expect(calls).toBe(1);
      expect(receipt).toEqual(
        Message.ReceivedDesktopAbout({
          reply: AboutReply.cases.Failed.make({
            message:
              "About could not be requested. Try again in the Mac desktop app.",
            version: 1,
          }),
        })
      );
      expect(JSON.stringify(receipt)).not.toContain("private transport detail");
      const completed = update(model, receipt).model;
      expect(completed.desktop.settings).toEqual(model.desktop.settings);
      expect(completed.desktop.request).toBe(model.desktop.request);
    })
);

it.effect(
  "fresh legacy observation clears an old About capability and stale observation cannot restore it",
  () =>
    Effect.sync(() => {
      const base = aboutCommandFixture();

      const notice = DesktopNotice.cases.Finished.make({
        outcome: DesktopOutcome.cases.Ready.make({
          error: Option.none(),
          settings: commandCatalogSettings(),
        }),
        request: base.desktop.request,
      });

      const cleared = update(base, Message.ReceivedDesktop({ notice })).model;
      expect(
        commandChoices(cleared).some((entry) => entry.id === "about")
      ).toBe(false);

      const stale = DesktopNotice.cases.Finished.make({
        ...notice,
        canShowAbout: true,
        request: base.desktop.request - 1,
      });

      const ignored = update(
        cleared,
        Message.ReceivedDesktop({ notice: stale })
      ).model;

      expect(
        commandChoices(ignored).some((entry) => entry.id === "about")
      ).toBe(false);
    })
);

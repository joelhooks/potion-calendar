import { DesktopAction } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { Url } from "foldkit/url";

import { Message, onUrlChange, update } from "../src/client/app.js";
import { DesktopNotice } from "../src/client/desktop/model.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { EditingRuntime } from "../src/client/editing/runtime.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import { SettingsRoute } from "../src/layout/route.js";
import { unusedBrowserLayers } from "./browser-runtime-fixture.js";
import { editorViewFields } from "./editor-fixture.js";
import { keyboardFixture } from "./keyboard-fixture.js";

const unexpectedDomainWork = Effect.die(
  new Error("Native Settings must not invoke editing or search")
);

const routeFence = Layer.mergeAll(
  unusedBrowserLayers,
  Layer.succeed(
    EditingRuntime,
    EditingRuntime.of({
      connect: () => unexpectedDomainWork,
      dispatch: () => unexpectedDomainWork,
    })
  ),
  Layer.succeed(
    CalendarSearchClient,
    CalendarSearchClient.of({
      prefetch: () => unexpectedDomainWork,
      search: () => unexpectedDomainWork,
    })
  )
);

const routeCommands = (result: ReturnType<typeof update>) =>
  (result.commands ?? [])
    .filter((command) => command.name === "NavigateRoute")
    .map((command) => ({ args: command.args, name: command.name }));

const openGeneral = Message.ReceivedDesktop({
  notice: DesktopNotice.cases.Action.make({
    action: DesktopAction.cases.OpenSettings.make({ page: "general" }),
  }),
});

it.effect(
  "native Settings uses the same General navigation command as G then S",
  () =>
    Effect.sync(() => {
      const model = keyboardFixture();

      const prefix = update(
        model,
        Message.PressedCalendarKey({
          alt: false,
          key: "g",
          mod: false,
          now: 1,
          shift: false,
        })
      );

      const keyboard = update(
        prefix.model,
        Message.PressedCalendarKey({
          alt: false,
          key: "s",
          mod: false,
          now: 2,
          shift: false,
        })
      );

      const native = update(model, openGeneral);

      expect(routeCommands(keyboard)).toEqual([
        {
          args: {
            replace: false,
            route: SettingsRoute.make({ page: "general" }),
          },
          name: "NavigateRoute",
        },
      ]);
      expect(routeCommands(native)).toEqual(routeCommands(keyboard));
      expect(native.model.route).toEqual(
        SettingsRoute.make({ page: "general" })
      );
    })
);

it.effect(
  "native Settings navigates the existing page while preserving an unsaved editor",
  () =>
    Effect.gen(function* settingsWithUnsavedEditor() {
      const base = keyboardFixture();

      const editor = EditorView.cases.Editing.make({
        ...editorViewFields,
        draft: {
          ...editorViewFields.draft,
          description: "Keep this unpublished description.",
          title: "Unsaved native-menu title",
        },
      });

      const model = {
        ...base,
        editing: { ...base.editing, owner: base.person, view: editor },
      };

      const state: unknown = window.history.state;
      const previous = { href: window.location.href, state };

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          window.history.replaceState(previous.state, "", previous.href);
        })
      );
      window.history.replaceState(null, "", "/");
      const requested = update(model, openGeneral);

      const navigate = requested.commands?.find(
        (command) => command.name === "NavigateRoute"
      );

      expect(requested.model.editing).toBe(model.editing);
      expect(requested.model.editing.view).toBe(editor);
      expect(requested.model.calendar).toBe(model.calendar);
      expect(requested.commands?.map((command) => command.name)).toEqual([
        "NavigateRoute",
      ]);
      expect(navigate).toBeDefined();

      if (navigate !== undefined) {
        yield* navigate.effect;
      }

      expect(window.location.pathname).toBe("/settings/general");

      const arrived = update(
        requested.model,
        onUrlChange(
          Url.make({
            hash: Option.none(),
            host: window.location.hostname,
            pathname: window.location.pathname,
            port: Option.none(),
            protocol: "http:",
            search: Option.none(),
          })
        )
      );

      expect(arrived.model.route).toEqual(
        SettingsRoute.make({ page: "general" })
      );
      expect(arrived.model.editing.view).toBe(editor);
      expect(arrived.model.editing.owner).toEqual(model.person);
      expect(arrived.model.calendar).toBe(model.calendar);
      expect(
        arrived.commands?.some((command) => command.name === "DispatchEdit")
      ).not.toBe(true);
    }).pipe(Effect.provide(routeFence), Effect.scoped)
);

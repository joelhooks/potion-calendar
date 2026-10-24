import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { AsyncData } from "foldkit";

import { Message, update } from "../src/client/app.js";
import {
  DesktopNotice,
  DesktopOutcome,
  DesktopRequest,
  RemoteDesktop,
} from "../src/client/desktop/model.js";
import { commandChoices } from "../src/client/keyboard/choices.js";
import { AccountSettingsRoute } from "../src/layout/route.js";
import {
  commandCatalogFixture,
  commandCatalogSettings,
} from "./command-catalog-fixture.js";

const DesktopArgs = Schema.Struct({ request: DesktopRequest });

const missingNativeSettings = (phase: "idle" | "loading" | "failed") => {
  switch (phase) {
    case "idle": {
      return RemoteDesktop.Idle();
    }

    case "loading": {
      return RemoteDesktop.Loading();
    }

    case "failed": {
      return RemoteDesktop.Failure({
        error: "Desktop settings are unavailable.",
      });
    }

    default: {
      throw new Error("Unknown prepared native settings phase");
    }
  }
};

it.effect.prop(
  "menu-bar command saves only the toggled native preference and waits for the applied bridge result",
  {
    accepted: Schema.Boolean,
    before: Schema.Boolean,
    showTime: Schema.Boolean,
  },
  ({ before, showTime, accepted }) =>
    Effect.sync(() => {
      const base = commandCatalogFixture();
      const settings = commandCatalogSettings(before);
      const preferences = { ...settings.preferences, showTime };
      const applied = { ...settings, preferences };

      const model = {
        ...base,
        desktop: {
          ...base.desktop,
          settings: RemoteDesktop.Success({ data: applied }),
        },
      };

      const entry = commandChoices(model).find(
        (choice) => choice.id === "desktop-menu-bar"
      );

      expect(
        entry,
        "Desktop catalog must project the existing menu-bar toggle"
      ).toBeDefined();
      expect(entry?.disabled).toBe(false);

      const result = update(
        model,
        Message.KeyboardPick({ id: "desktop-menu-bar" })
      );

      const requests = (result.commands ?? [])
        .filter((command) => command.name === "ApplyDesktopRequest")
        .map(
          (command) =>
            Schema.decodeUnknownSync(DesktopArgs)(command.args).request
        );

      expect(requests).toEqual([
        DesktopRequest.cases.Save.make({
          preferences: { ...preferences, menuBar: !before },
          request: model.desktop.request + 1,
        }),
      ]);
      expect(result.model.keyboard.screen).toBe("closed");
      expect(
        Option.getOrThrow(AsyncData.getData(result.model.desktop.settings))
      ).toEqual(applied);
      expect(
        AsyncData.isRefreshing(result.model.desktop.settings),
        "Native save must enter Refreshing rather than mutate applied data"
      ).toBe(true);

      const reopened = update(
        result.model,
        Message.KeyboardAction({ id: "commands" })
      ).model;

      expect(
        commandChoices(reopened).find(
          (choice) => choice.id === "desktop-menu-bar"
        )?.disabled,
        "In-flight native save must disable a second catalog pick"
      ).toBe(true);

      const duplicate = update(
        reopened,
        Message.KeyboardPick({ id: "desktop-menu-bar" })
      );

      expect(duplicate.commands ?? []).toEqual([]);
      expect(duplicate.model.desktop.request).toBe(
        result.model.desktop.request
      );

      const observed = update(
        result.model,
        Message.ReceivedDesktop({
          notice: DesktopNotice.cases.Finished.make({
            outcome: DesktopOutcome.cases.Ready.make({
              error: accepted
                ? Option.none()
                : Option.some("Native menu bar change was refused."),
              settings: {
                ...applied,
                preferences: {
                  ...preferences,
                  menuBar: accepted ? !before : before,
                },
                revision: applied.revision + 1,
              },
            }),
            request: result.model.desktop.request,
          }),
        })
      ).model;

      expect(
        Option.getOrThrow(AsyncData.getData(observed.desktop.settings))
          .preferences.menuBar
      ).toBe(accepted ? !before : before);
      expect(
        Option.isSome(observed.desktop.error),
        "Applied native refusal must remain visible"
      ).toBe(!accepted);
    })
);

it.effect.each(["unknown", "unavailable"] as const)(
  "menu-bar command is hidden outside an available desktop shell (%s)",
  (availability) =>
    Effect.sync(() => {
      const base = commandCatalogFixture();
      const model = { ...base, desktop: { ...base.desktop, availability } };
      expect(
        commandChoices(model).some((choice) => choice.id === "desktop-menu-bar")
      ).toBe(false);

      const result = update(
        model,
        Message.KeyboardPick({ id: "desktop-menu-bar" })
      );

      expect(result.commands ?? []).toEqual([]);
      expect(result.model.desktop).toEqual(model.desktop);
    })
);

it.effect.each(["idle", "loading", "failed"] as const)(
  "menu-bar command cannot fabricate native preferences before applied settings arrive (%s)",
  (phase) =>
    Effect.sync(() => {
      const base = commandCatalogFixture();
      const settings = missingNativeSettings(phase);
      const model = { ...base, desktop: { ...base.desktop, settings } };

      const entry = commandChoices(model).find(
        (choice) => choice.id === "desktop-menu-bar"
      );

      expect(
        entry,
        "Applicable desktop command stays visible while native settings load"
      ).toBeDefined();
      expect(entry?.disabled).toBe(true);
      expect(
        update(model, Message.KeyboardPick({ id: "desktop-menu-bar" }))
          .commands ?? []
      ).toEqual([]);
    })
);

it.effect.prop(
  "week-number command toggles through the existing saved-preferences writer",
  { before: Schema.Boolean },
  ({ before }) =>
    Effect.sync(() => {
      const base = commandCatalogFixture(false);

      const model = {
        ...base,
        settings: { ...base.settings, showWeekNumbers: before },
      };

      const entry = commandChoices(model).find(
        (choice) => choice.id === "week-numbers"
      );

      expect(
        entry,
        "Existing week-number action must be discoverable in the command catalog"
      ).toBeDefined();

      const result = update(
        model,
        Message.KeyboardPick({ id: "week-numbers" })
      );

      expect(result.model.settings.showWeekNumbers).toBe(!before);
      expect(result.model.keyboard.screen).toBe("closed");
      expect(
        result.commands?.filter((command) => command.name === "SavePreferences")
      ).toHaveLength(1);
      expect(
        result.commands?.filter(
          (command) => command.name === "ApplyDesktopRequest"
        )
      ).toHaveLength(0);
    })
);

it.effect(
  "Manage calendar accounts opens the existing account-management route without adding an account",
  () =>
    Effect.sync(() => {
      const model = commandCatalogFixture(false);
      expect(
        commandChoices(model).find((choice) => choice.id === "manage-accounts"),
        "Existing account management route must be discoverable"
      ).toBeDefined();

      const result = update(
        model,
        Message.KeyboardPick({ id: "manage-accounts" })
      );

      expect(result.model.route).toEqual(
        AccountSettingsRoute.make({ accountId: "work" })
      );
      expect(result.model.keyboard.screen).toBe("closed");
      expect(
        result.commands?.filter((command) => command.name === "NavigateRoute")
      ).toHaveLength(1);
      expect(
        result.commands?.some((command) => command.name === "BeginGoogle")
      ).not.toBe(true);
    })
);

it.effect(
  "existing all-day and hour-zoom entries remain available without duplicate replacement actions",
  () =>
    Effect.sync(() => {
      const choices = commandChoices(commandCatalogFixture(false));

      for (const id of ["all-day", "zoom-reset", "zoom-in", "zoom-out"]) {
        expect(choices.filter((choice) => choice.id === id)).toHaveLength(1);
      }
    })
);

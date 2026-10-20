import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Predicate } from "effect";
import { renderToString } from "foldkit/experimental/server";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import { bindingHints } from "../src/client/keyboard/registry.js";
import { view } from "../src/features/app.js";
import {
  AccountSettingsRoute,
  CalendarRoute,
  SettingsRoute,
} from "../src/layout/route.js";
import { fixtureSelection } from "./fixture.js";

it.effect(
  "exports the actual settings pages and Dark and 24-hour weeks for fenced review",
  () =>
    Effect.gen(function* settingsArtifacts() {
      const platform = vi
        .spyOn(navigator, "platform", "get")
        .mockReturnValue("MacIntel");

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          platform.mockRestore();
        })
      );
      platform.mockReturnValue("Linux x86_64");
      expect(bindingHints("commands")).toEqual(["Ctrl+K"]);
      platform.mockReturnValue("MacIntel");
      expect(bindingHints("commands")).toEqual(["⌘K"]);
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");
      const base = fixtureSelection();

      const darkMenu = update(
        { ...base, settings: { ...base.settings, theme: "dark" } },
        Message.KeyboardAction({ id: "commands" })
      ).model;

      const cases = [
        {
          id: "dark-commands",
          model: darkMenu,
          selector: "#keyboard-command-dialog",
        },
        {
          id: "general",
          model: { ...base, route: SettingsRoute.make({ page: "general" }) },
          selector: "#settings-clock",
        },
        {
          id: "notifications",
          model: {
            ...base,
            route: SettingsRoute.make({ page: "notifications" }),
          },
          selector: "#settings-event-invites",
        },
        {
          id: "calendars",
          model: { ...base, route: SettingsRoute.make({ page: "calendars" }) },
          selector: ".settings-account-link",
        },
        {
          id: "account",
          model: {
            ...base,
            route: AccountSettingsRoute.make({ accountId: "work" }),
          },
          selector: ".settings-calendar-row",
        },
        {
          id: "account-reconnect",
          model: {
            ...base,
            route: AccountSettingsRoute.make({ accountId: "revoked" }),
          },
          selector: ".settings-content [role='alert']",
        },
        {
          id: "dark-week",
          model: {
            ...base,
            route: CalendarRoute.make({}),
            settings: { ...base.settings, theme: "dark" as const },
          },
          selector: ".theme-dark .event-chip",
        },
        {
          id: "24hour-week",
          model: {
            ...base,
            route: CalendarRoute.make({}),
            settings: { ...base.settings, timeFormat: "24" as const },
          },
          selector: ".event-time",
        },
      ];

      for (const fixture of cases) {
        const rendered = yield* renderToString(
          { init: () => ({ model: fixture.model }), view },
          { isHydratable: false }
        );

        const document = new DOMParser().parseFromString(
          rendered.html,
          "text/html"
        );

        expect(
          document.querySelector(fixture.selector),
          fixture.id
        ).not.toBeNull();

        if (Predicate.isTagged(fixture.model.route, "Settings")) {
          expect(
            document.querySelectorAll(".toolbar button, .toolbar select")
          ).toHaveLength(0);
          expect(document.querySelector(".toolbar")?.textContent).toBe(
            "Calendar"
          );
        }

        if (fixture.id === "dark-commands") {
          expect(document.body.textContent).toContain("⌘K");
          expect(document.body.textContent).not.toContain("Ctrl+K");
        }

        if (fixture.id === "account-reconnect") {
          expect(document.body.textContent).toContain("Reconnect");
          expect(document.body.textContent).toContain(
            "Calendars for this account appear after you reconnect."
          );
          expect(document.body.textContent).not.toContain(
            "No calendars in this group"
          );
          expect(document.body.textContent).not.toContain(
            "The default calendar is used"
          );
          expect(
            document.querySelector(".settings-remove button")?.textContent
          ).toBe("Remove account");
        }

        if (fixture.id === "general") {
          expect(document.body.textContent).toContain("Week · 7 days");

          for (const name of [
            "Weekends",
            "Declined events",
            "Week numbers",
            "Start week on",
            "Press T to",
            "Time format",
            "Theme",
          ]) {
            expect(document.body.textContent).toContain(name);
          }

          for (const excluded of [
            "Notion",
            "Remove account",
            "Menu bar",
            "Conferencing",
          ]) {
            expect(document.body.textContent).not.toContain(excluded);
          }
        }

        if (fixture.id === "account") {
          expect(document.querySelector(".settings-default")?.textContent).toBe(
            "Default calendar"
          );
          expect(
            [...document.querySelectorAll("button")].some(
              (button) => button.textContent === "Default calendar"
            )
          ).toBe(false);
          expect(document.body.textContent).toContain("Reconnect");
          expect(document.body.textContent).toContain("Owned calendars");
          expect(document.body.textContent).toContain("Subscribed calendars");
          expect(
            document.querySelectorAll(".settings-calendar-row").length
          ).toBe(
            base.calendar.calendars.filter(
              (calendar) => calendar.accountId === "work"
            ).length
          );
          expect(document.body.textContent).not.toContain("Pinned");
        }

        if (fixture.id === "24hour-week") {
          expect(rendered.html).not.toMatch(/\b\d+(?::\d\d)?(?:am|pm)\b/iu);
        }

        yield* fs.writeFileString(
          `../../.git/settings-${fixture.id}-fixture.html`,
          `<!doctype html><html><head><meta charset="utf-8"><meta name="fixture-keyboard-platform" content="MacIntel"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${rendered.html}<script>document.querySelector('dialog')?.showModal();document.querySelector('#keyboard-query')?.focus();</script></body></html>`
        );
      }
    }).pipe(Effect.provide(NodeServices.layer))
);

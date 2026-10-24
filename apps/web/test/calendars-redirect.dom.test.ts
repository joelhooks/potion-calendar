import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { AsyncData } from "foldkit";
import { renderToString } from "foldkit/experimental/server";
import type { HtmlBuilder } from "foldkit/html";
import { Scene } from "foldkit/test";

import { Message, RemoteSession, update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { ManageSettings } from "../src/client/settings-management/commands.js";
import {
  ColourTask,
  ManagementChange,
  ManagementOutcome,
} from "../src/client/settings-management/model.js";
import { PrepareColourPicker } from "../src/client/settings-management/picker.js";
import { view } from "../src/features/app.js";
import { settingsPage } from "../src/features/settings.js";
import { SettingsRoute } from "../src/layout/route.js";
import { calendarsRedirectFixture } from "./calendars-redirect-fixture.js";
import { settingsManagementFixture } from "./settings-management-fixture.js";

const accountView = (model: AppModel, h: HtmlBuilder<AppMessage>) => ({
  body: settingsPage(model, h, "calendar", "work"),
  title: "Account preservation",
});

it.effect(
  "the cached reconnect color control dispatches the same existing account-qualified color task",
  () =>
    Effect.sync(() => {
      const base = settingsManagementFixture("account", false, 900);

      const snapshot = Option.getOrThrow(
        Option.fromNullishOr(Option.getOrThrow(AsyncData.getData(base.session)))
      );

      const model = {
        ...base,
        session: RemoteSession.Success({
          data: {
            ...snapshot,
            accounts: snapshot.accounts.map((account) => ({
              ...account,
              disconnected: true,
            })),
          },
        }),
      };

      const task = ColourTask.make({
        accountId: "work",
        calendarId: "primary",
        colorId: "2",
        personId: Option.getOrThrow(base.person),
        requestId: 1,
      });

      Scene.scene(
        { update, view: accountView },
        Scene.given(model),
        Scene.click(Scene.role("button", { name: "Choose color for Work" })),
        Scene.Mount.resolve(PrepareColourPicker, Message.Navigated()),
        Scene.click(Scene.role("button", { name: "Color 2" })),
        Scene.Mount.expectEnded(PrepareColourPicker),
        Scene.Command.expectHas(ManageSettings({ task })),
        Scene.expect(
          Scene.role("button", { name: "Choose color for Work" })
        ).toBeDisabled(),
        Scene.Command.resolve(
          ManageSettings,
          Message.ChangedSettingsManagement({
            change: ManagementChange.cases.Settled.make({
              outcome: ManagementOutcome.cases.Failed.make({
                problem: {
                  kind: "refused",
                  message:
                    "This color change was refused. The saved color is shown.",
                },
                task,
              }),
            }),
          })
        ),
        Scene.expect(
          Scene.text("This color change was refused. The saved color is shown.")
        ).toExist()
      );
    })
);

it.effect(
  "reconnect account landing preserves the cached overview appearance rows beneath its warning without enabling default choice",
  () =>
    Effect.gen(function* reconnectPreservation() {
      const model = calendarsRedirectFixture("reconnect");

      const rendered = yield* renderToString(
        { init: () => ({ model }), view: accountView },
        { isHydratable: false }
      );

      const root = new DOMParser().parseFromString(rendered.html, "text/html");
      const rows = root.querySelectorAll(".settings-calendar-row");

      const expected = model.calendar.calendars.filter(
        (calendar) => calendar.accountId === "work"
      );

      expect(
        rows.length,
        "Cached calendars must remain reachable on the reconnect account page"
      ).toBe(expected.length);

      for (const calendar of expected) {
        expect(
          root.querySelector(
            `input[aria-label="Show events from ${calendar.title}"]`
          ),
          "Cached visibility control must survive"
        ).not.toBeNull();
        expect(
          root.querySelector(
            `button[aria-label="Choose color for ${calendar.title}"]`
          ),
          "Cached color control must survive"
        ).not.toBeNull();
      }

      expect(root.querySelector(".settings-default")).toBeNull();
      expect(
        [...root.querySelectorAll("button")].some(
          (button) => button.textContent === "Use as default"
        )
      ).toBe(false);
      const content = root.querySelector(".settings-content");
      expect(content?.textContent).toContain(
        "Reconnect this account to restore calendar access."
      );
      expect(
        content?.textContent,
        "Cached rows must not be described as absent until reconnect"
      ).toContain(
        "Showing calendars saved before this account disconnected. Reconnect to update them."
      );
      expect(content?.textContent).not.toContain(
        "Calendars for this account appear after you reconnect."
      );
      expect(
        content?.textContent?.indexOf("Reconnect this account")
      ).toBeLessThan(
        content?.textContent?.indexOf(expected[0]?.title ?? "missing") ?? -1
      );
    })
);

it.effect(
  "a reconnect account without cached calendars keeps the existing reconnect explanation and controls",
  () =>
    Effect.gen(function* emptyReconnect() {
      const base = calendarsRedirectFixture("reconnect");

      const model = {
        ...base,
        calendar: {
          ...base.calendar,
          calendars: base.calendar.calendars.filter(
            (calendar) => calendar.accountId !== "work"
          ),
        },
      };

      const rendered = yield* renderToString(
        { init: () => ({ model }), view: accountView },
        { isHydratable: false }
      );

      const root = new DOMParser().parseFromString(rendered.html, "text/html");
      const content = root.querySelector(".settings-content");
      expect(content?.textContent).toContain(
        "Calendars for this account appear after you reconnect."
      );
      expect(content?.textContent).not.toContain(
        "Showing calendars saved before this account disconnected."
      );
      expect(content?.querySelector('[role="alert"]')?.textContent).toBe(
        "Reconnect this account to restore calendar access."
      );
      expect(
        [...(content?.querySelectorAll("button") ?? [])].some(
          (button) => button.textContent === "Reconnect" && !button.disabled
        )
      ).toBe(true);
      expect(content?.querySelectorAll(".settings-calendar-row")).toHaveLength(
        0
      );
    })
);

it.effect(
  "a deep-linked Calendars session failure renders the existing root reload alert instead of an endless opening placeholder",
  () =>
    Effect.gen(function* failedDeepLink() {
      const base = calendarsRedirectFixture();

      const loading = {
        ...base,
        route: SettingsRoute.make({ page: "calendars" }),
        session: RemoteSession.Loading(),
      };

      const failed = update(loading, Message.FailedSession());

      const rendered = yield* renderToString(
        { init: () => ({ model: failed.model }), view },
        { isHydratable: false }
      );

      const root = new DOMParser().parseFromString(rendered.html, "text/html");
      expect(
        root.querySelector('.auth-shell [role="alert"]')?.textContent
      ).toBe("Could not load your session. Reload to try again.");
      expect(root.body.textContent).not.toContain("Opening calendar settings…");
      expect(root.querySelector(".settings-content")).toBeNull();
      expect(
        failed.commands?.some((command) => command.name === "NavigateRoute") ??
          false
      ).toBe(false);
    })
);

it.effect(
  "settings sidebar account entries retain their own encoded account routes on a redirected landing",
  () =>
    Effect.gen(function* accountSidebar() {
      const model = calendarsRedirectFixture();

      const rendered = yield* renderToString(
        { init: () => ({ model }), view: accountView },
        { isHydratable: false }
      );

      const root = new DOMParser().parseFromString(rendered.html, "text/html");
      expect(
        [...root.querySelectorAll(".settings-account-nav")].map((entry) =>
          entry.getAttribute("href")
        )
      ).toEqual([
        "/settings/calendar/work",
        "/settings/calendar/personal",
        "/settings/calendar/revoked",
      ]);
      expect(
        root
          .querySelector('.settings-account-nav[aria-current="page"]')
          ?.getAttribute("href")
      ).toBe("/settings/calendar/work");
    })
);

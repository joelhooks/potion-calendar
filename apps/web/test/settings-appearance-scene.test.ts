import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import type { HtmlBuilder } from "foldkit/html";
import { Scene } from "foldkit/test";

import { Message, update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { ReadEvents, SavePreferences } from "../src/client/commands.js";
import { ManageSettings } from "../src/client/settings-management/commands.js";
import {
  ColourTask,
  ManagementChange,
  ManagementOutcome,
} from "../src/client/settings-management/model.js";
import { PrepareColourPicker } from "../src/client/settings-management/picker.js";
import { sidebar } from "../src/features/calendar.js";
import { settingsCalendars } from "../src/features/settings-calendars.js";
import { chipColors } from "../src/layout/settings-colors.js";
import { fixtureEvents } from "./fixture.js";
import { settingsManagementFixture } from "./settings-management-fixture.js";

const page = (model: AppModel, h: HtmlBuilder<AppMessage>) => ({
  body: h.div([], [sidebar(model, h), ...settingsCalendars(model, h, "work")]),
  title: "Calendar appearance",
});

const swatch =
  ".account[data-account-id='work'] .calendar-toggle[aria-checked='true'] .swatch";

it.effect(
  "the actual colour picker previews the Google calendar palette in the sidebar and a refusal rolls it back",
  () =>
    Effect.sync(() => {
      const base = settingsManagementFixture("account", false, 1440);

      const task = ColourTask.make({
        accountId: "work",
        calendarId: "primary",
        colorId: "2",
        personId: Option.getOrThrow(base.person),
        requestId: 1,
      });

      Scene.scene(
        { update, view: page },
        Scene.given(base),
        Scene.click(Scene.role("button", { name: "Choose colour for Work" })),
        Scene.Mount.resolve(PrepareColourPicker, Message.Navigated()),
        Scene.expect(
          Scene.role("group", { name: "Calendar colours for Work" })
        ).toExist(),
        Scene.click(Scene.role("button", { name: "Colour 2" })),
        Scene.Mount.expectEnded(PrepareColourPicker),
        Scene.expect(Scene.selector(swatch)).toHaveStyle(
          "--event-color",
          chipColors("#225522", "light").accent
        ),
        Scene.expect(
          Scene.role("button", { name: "Choose colour for Work" })
        ).toBeDisabled(),
        Scene.Command.resolve(
          ManageSettings,
          Message.ChangedSettingsManagement({
            change: ManagementChange.cases.Settled.make({
              outcome: ManagementOutcome.cases.Failed.make({
                problem: {
                  kind: "refused",
                  message:
                    "This colour change was refused. The saved colour is shown.",
                },
                task,
              }),
            }),
          })
        ),
        Scene.expect(Scene.selector(swatch)).toHaveStyle(
          "--event-color",
          chipColors("#4986E8", "light").accent
        ),
        Scene.expect(
          Scene.role("button", { name: "Choose colour for Work" })
        ).toBeEnabled(),
        Scene.expect(
          Scene.role("group", { name: "Calendar colours for Work" })
        ).toBeAbsent()
      );
    })
);

it.effect(
  "the Settings checkbox and sidebar checkbox share the same local writer and projected state",
  () =>
    Effect.sync(() => {
      const base = settingsManagementFixture("account", false, 900);
      Scene.scene(
        { update, view: page },
        Scene.given(base),
        Scene.change(
          Scene.role("checkbox", { name: "Show events from Work" }),
          "off"
        ),
        Scene.Command.resolve(SavePreferences, Message.SavedPreferences()),
        Scene.Command.resolve(
          ReadEvents,
          Message.ReceivedEvents({
            accountId: "personal",
            request: base.calendar.rangeRequest + 1,
            result: {
              events: fixtureEvents.filter(
                (event) => event.accountId === "personal"
              ),
              versions: [],
            },
          })
        ),
        Scene.expect(Scene.role("checkbox", { name: "Work" })).toHaveAttr(
          "aria-checked",
          "false"
        ),
        Scene.expect(
          Scene.role("checkbox", { name: "Show events from Work" })
        ).not.toBeChecked()
      );
    })
);

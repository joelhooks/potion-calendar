import {
  DisconnectAccountResult,
  disconnectAccountInstruction,
} from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { AsyncData } from "foldkit";
import type { HtmlBuilder } from "foldkit/html";
import { Scene } from "foldkit/test";

import { Message, update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { ReadCalendars, ReadEvents } from "../src/client/commands.js";
import { ManageSettings } from "../src/client/settings-management/commands.js";
import { PrepareAccountRemoval } from "../src/client/settings-management/dialog.js";
import {
  ManagementChange,
  ManagementOutcome,
  ManagementValue,
  RemovalTask,
} from "../src/client/settings-management/model.js";
import { sidebar } from "../src/features/calendar.js";
import { settingsCalendars } from "../src/features/settings-calendars.js";
import { fixtureEvents, fixtureIndex } from "./fixture.js";
import { settingsManagementFixture } from "./settings-management-fixture.js";

const page = (model: AppModel, h: HtmlBuilder<AppMessage>) => ({
  body: h.div(
    [
      h.Id("management-state"),
      h.DataAttribute(
        "accounts",
        (
          Option.getOrUndefined(AsyncData.getData(model.session))?.accounts ??
          []
        )
          .map((account) => account.id)
          .join(",")
      ),
      h.DataAttribute(
        "write-sequence",
        String(model.settingsManagement.sequence)
      ),
    ],
    [sidebar(model, h), ...settingsCalendars(model, h, "work")]
  ),
  title: "Settings management",
});

it.effect(
  "the real Remove dialog names the email, explains no revoke, cancels without writing, and the successful path removes the current account projection",
  () =>
    Effect.sync(() => {
      const base = settingsManagementFixture("account", false, 1440);
      Scene.scene(
        { update, view: page },
        Scene.given(base),
        Scene.click(Scene.role("button", { name: "Remove account" })),
        Scene.Mount.resolve(PrepareAccountRemoval, Message.Navigated()),
        Scene.expect(
          Scene.role("dialog", { name: "Remove Google account" })
        ).toContainText("owner@example.test"),
        Scene.expect(
          Scene.role("dialog", { name: "Remove Google account" })
        ).toContainText("does not revoke Google access"),
        Scene.click(Scene.role("button", { name: "Cancel" })),
        Scene.Mount.expectEnded(PrepareAccountRemoval),
        Scene.expect(
          Scene.role("dialog", { name: "Remove Google account" })
        ).toBeAbsent(),
        Scene.expect(Scene.selector("#management-state")).toHaveAttr(
          "data-write-sequence",
          "0"
        )
      );

      const task = RemovalTask.make({
        accountId: "work",
        personId: Option.getOrThrow(base.person),
        requestId: 1,
      });

      const result = DisconnectAccountResult.make({
        accountId: "work",
        disconnected: true,
        instruction: disconnectAccountInstruction,
        revocation: "notAttempted",
      });

      Scene.scene(
        { update, view: page },
        Scene.given(base),
        Scene.click(Scene.role("button", { name: "Remove account" })),
        Scene.Mount.resolve(PrepareAccountRemoval, Message.Navigated()),
        Scene.click(Scene.role("button", { name: "Confirm remove account" })),
        Scene.Command.resolve(
          ManageSettings,
          Message.ChangedSettingsManagement({
            change: ManagementChange.cases.Settled.make({
              outcome: ManagementOutcome.cases.Succeeded.make({
                task,
                value: ManagementValue.cases.Removed.make({ result }),
              }),
            }),
          })
        ),
        Scene.Mount.expectEnded(PrepareAccountRemoval),
        Scene.Command.resolve(
          ReadCalendars,
          Message.ReceivedCalendars({
            result: {
              accounts: fixtureIndex.accounts.filter(
                (account) => account.accountId !== "work"
              ),
            },
          })
        ),
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
        Scene.expect(
          Scene.role("heading", { name: "Account removed" })
        ).toExist(),
        Scene.expect(Scene.role("status")).toContainText(
          disconnectAccountInstruction
        ),
        Scene.expect(Scene.selector("#management-state")).toHaveAttr(
          "data-accounts",
          "personal,revoked"
        )
      );
    })
);

it.effect(
  "a single remaining account shows an honest disabled reason and no destructive command",
  () =>
    Effect.sync(() => {
      const model = settingsManagementFixture("last", false, 900);
      Scene.scene(
        { update, view: page },
        Scene.given(model),
        Scene.expect(
          Scene.role("button", { name: "Remove account" })
        ).toBeDisabled(),
        Scene.expect(Scene.selector("#settings-removal-reason")).toContainText(
          "Add another Google account before removing this one."
        ),
        Scene.expect(
          Scene.role("button", { name: "Remove account" })
        ).toHaveAttr("aria-describedby", "settings-removal-reason"),
        Scene.expect(Scene.role("alert")).toBeAbsent(),
        Scene.expect(
          Scene.role("button", { name: "Refresh accounts" })
        ).toBeAbsent()
      );

      const refused = update(
        model,
        Message.ChangedSettingsManagement({
          change: ManagementChange.cases.Remove.make({ accountId: "work" }),
        })
      );

      expect(
        refused.commands?.some(
          (command) => command.name === "ManageSettings"
        ) ?? false
      ).toBe(false);
    })
);

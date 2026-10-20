import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { HtmlBuilder } from "foldkit/html";
import { Scene } from "foldkit/test";

import { Message } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { settingsPage } from "../src/features/settings.js";
import { fixtureModel } from "./fixture.js";

it.effect.each(["work", "revoked"])(
  "account %s reconnect sends the existing Google authorization action",
  (accountId) =>
    Effect.sync(() => {
      const messages: AppMessage[] = [];
      Scene.scene(
        {
          update: (model: AppModel, message: AppMessage) => {
            messages.push(message);

            return { model };
          },
          view: (model: AppModel, h: HtmlBuilder<AppMessage>) => ({
            body: settingsPage(model, h, "calendar", accountId),
            title: "Account settings",
          }),
        },
        Scene.given(fixtureModel()),
        ...(accountId === "revoked"
          ? [
              Scene.expect(Scene.selector(".settings-content")).toContainText(
                "Calendars for this account appear after you reconnect."
              ),
              Scene.expect(
                Scene.role("heading", { name: "Owned calendars" })
              ).toBeAbsent(),
              Scene.expect(
                Scene.role("heading", { name: "Subscribed calendars" })
              ).toBeAbsent(),
            ]
          : []),
        Scene.click(Scene.role("button", { name: "Reconnect" }))
      );
      expect(messages).toEqual([Message.ClickedAddGoogle()]);
    })
);

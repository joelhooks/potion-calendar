import { it } from "@effect/vitest";
import { Effect } from "effect";
import type { HtmlBuilder } from "foldkit/html";
import { Scene } from "foldkit/test";

import { Message, update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { SavePreferences } from "../src/client/commands.js";
import { settingsTimeBlocks } from "../src/features/settings-time-blocks.js";
import { timeBlockModel } from "./time-block-fixture.js";

it.effect(
  "actual Settings controls keep invalid drafts local, submit one save, enable, cancel an edit and remove through the root recipient",
  () =>
    Effect.sync(() => {
      Scene.scene(
        {
          update,
          view: (model: AppModel, h: HtmlBuilder<AppMessage>) => ({
            body: settingsTimeBlocks(model, h),
            title: "Time blocks",
          }),
        },
        Scene.given(timeBlockModel("settings-empty")),
        Scene.expect(Scene.selector("#time-blocks-enabled")).toHaveAttr(
          "type",
          "checkbox"
        ),
        Scene.click(Scene.role("button", { name: "Add time block" })),
        Scene.expect(Scene.selector("#time-block-start-0")).toHaveValue(""),
        Scene.expect(Scene.selector("#time-block-end-0")).toHaveValue(""),
        Scene.click(Scene.role("button", { name: "Save time block" })),
        Scene.expect(Scene.selector(".time-block-editor")).toContainText(
          "Enter a name and at least one range."
        ),
        Scene.Command.expectNone(),
        Scene.type(Scene.selector("#time-block-name"), "Evening"),
        Scene.type(Scene.selector("#time-block-start-0"), "11:00"),
        Scene.type(Scene.selector("#time-block-end-0"), "09:00"),
        Scene.click(Scene.role("button", { name: "Save time block" })),
        Scene.expect(Scene.selector("#time-block-end-0")).toHaveAttr(
          "aria-invalid",
          "true"
        ),
        Scene.expect(Scene.selector("#time-block-end-0")).toHaveAttr(
          "aria-describedby",
          "time-block-end-0-error"
        ),
        Scene.expect(Scene.selector("#time-block-end-0-error")).toContainText(
          "End must be after start."
        ),
        Scene.Command.expectNone(),
        Scene.type(Scene.selector("#time-block-start-0"), "21:00"),
        Scene.type(Scene.selector("#time-block-end-0"), "24:00"),
        Scene.click(
          Scene.role("checkbox", { name: "Hide these ranges in the grid" })
        ),
        Scene.click(Scene.role("button", { name: "Save time block" })),
        Scene.Command.expectExact(SavePreferences),
        Scene.Command.resolve(SavePreferences, Message.SavedPreferences()),
        Scene.expect(Scene.selector(".time-block-item")).toContainText(
          "Evening"
        ),
        Scene.expect(Scene.selector(".time-block-item")).toContainText(
          "Hidden · 21:00–24:00"
        ),
        Scene.click(Scene.selector("#time-blocks-enabled")),
        Scene.Command.expectExact(SavePreferences),
        Scene.Command.resolve(SavePreferences, Message.SavedPreferences()),
        Scene.click(Scene.role("button", { name: "Edit Evening" })),
        Scene.type(Scene.selector("#time-block-start-0"), "22:00"),
        Scene.click(Scene.role("button", { name: "Cancel" })),
        Scene.Command.expectNone(),
        Scene.expect(Scene.selector(".time-block-item")).toContainText(
          "21:00–24:00"
        ),
        Scene.click(Scene.role("button", { name: "Remove Evening" })),
        Scene.Command.expectExact(SavePreferences),
        Scene.Command.resolve(SavePreferences, Message.SavedPreferences()),
        Scene.expect(Scene.selector(".time-block-empty")).toContainText(
          "No time blocks"
        )
      );
    })
);

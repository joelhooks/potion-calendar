import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import type { HtmlBuilder } from "foldkit/html";
import { Scene } from "foldkit/test";

import { Message, update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { WriteConferencingDefault } from "../src/client/conferencing/commands.js";
import {
  ConferencingChange,
  RemoteConferencingDefault,
} from "../src/client/conferencing/model.js";
import { settingsPage } from "../src/features/settings.js";
import { fixtureModel } from "./fixture.js";

it.effect.each(["none", "googleMeet"] as const)(
  "the account page sends and confirms %s through the shared preference command",
  (value) =>
    Effect.sync(() => {
      const fixture = fixtureModel();

      const model: AppModel = {
        ...fixture,
        conferencing: {
          accounts: {
            work: {
              operation: "read",
              remote: RemoteConferencingDefault.Success({
                data: { accountId: "work", value: "unset" },
              }),
              requestId: 1,
            },
          },
          nextRequestId: 1,
        },
      };

      Scene.scene(
        {
          update,
          view: (state: AppModel, h: HtmlBuilder<AppMessage>) => ({
            body: h.main([], [settingsPage(state, h, "calendar", "work")]),
            title: "Account settings",
          }),
        },
        Scene.given(model),
        Scene.change(Scene.selector("#conferencing-default-work"), value),
        Scene.expect(
          Scene.selector("#conferencing-default-work")
        ).toBeDisabled(),
        Scene.expect(Scene.role("status")).toContainText("Saving"),
        Scene.Command.resolve(
          WriteConferencingDefault,
          Message.ChangedConferencing({
            change: ConferencingChange.cases.Received.make({
              accountId: "work",
              personId: Option.getOrThrow(model.person),
              requestId: 2,
              result: { accountId: "work", value },
            }),
          })
        ),
        Scene.expect(Scene.selector("#conferencing-default-work")).toHaveValue(
          value
        ),
        Scene.expect(Scene.selector("#conferencing-default-work")).toBeEnabled()
      );
    })
);

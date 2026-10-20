import { Effect } from "effect";
import { Command } from "foldkit";

import { Message } from "../message.js";
import { SettingsManagementClient } from "./client.js";
import { performSettingsManagement } from "./machine.js";
import { ManagementChange, ManagementTask } from "./model.js";

export const ManageSettings = Command.define("ManageSettings", {
  args: { task: ManagementTask },
  execute: ({ task }) =>
    performSettingsManagement(task).pipe(
      Effect.provide(SettingsManagementClient.layer),
      Effect.map((outcome) =>
        Message.ChangedSettingsManagement({
          change: ManagementChange.cases.Settled.make({ outcome }),
        })
      )
    ),
  messages: [Message.ChangedSettingsManagement],
});

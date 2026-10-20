import { Effect, Schema } from "effect";
import { Command } from "foldkit";

import { Message } from "../message.js";
import { EditingCommand, EditingRuntime } from "./runtime.js";

export const DispatchEditing = Command.define("DispatchEditing", {
  args: { command: EditingCommand, personId: Schema.String },
  execute: ({ command, personId }) =>
    EditingRuntime.use((runtime) => runtime.dispatch(personId, command)).pipe(
      Effect.match({
        onFailure: (failure) =>
          Message.FailedEditing({ message: failure.message }),
        onSuccess: () => Message.DispatchedEditing(),
      })
    ),
  messages: [Message.DispatchedEditing, Message.FailedEditing],
});

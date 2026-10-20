import { Effect, Schema } from "effect";
import { Command } from "foldkit";

import { EditingCommand, EditingRuntime } from "../editing/runtime.js";
import { Message } from "../message.js";
import { ClipboardCutInput, prepareClipboardCut } from "./cut.js";
import { ClipboardAction, ClipboardRuntime } from "./runtime.js";

export const DispatchClipboard = Command.define("DispatchClipboard", {
  args: {
    action: ClipboardAction,
    personId: Schema.String,
    sessionId: Schema.String,
  },
  execute: ({ action, personId, sessionId }) =>
    ClipboardRuntime.use((runtime) =>
      runtime.dispatch(personId, sessionId, action)
    ).pipe(
      Effect.match({
        onFailure: (failure) =>
          Message.FailedClipboard({
            message: failure.message,
            personId,
            sessionId,
          }),
        onSuccess: () => Message.DispatchedClipboard(),
      })
    ),
  messages: [Message.DispatchedClipboard, Message.FailedClipboard],
});

export const DispatchClipboardCut = Command.define("DispatchClipboardCut", {
  args: {
    input: ClipboardCutInput,
    personId: Schema.String,
    sessionId: Schema.String,
  },
  execute: ({ personId, input, sessionId }) =>
    Effect.gen(function* openClipboardDeletion() {
      const clipboard = yield* ClipboardRuntime;
      yield* clipboard.validateSession(personId, sessionId);
      const request = yield* prepareClipboardCut(input);
      const editing = yield* EditingRuntime;
      yield* editing.dispatch(
        personId,
        EditingCommand.cases.Open.make({ request })
      );
    }).pipe(
      Effect.match({
        onFailure: (failure) =>
          Message.FailedClipboard({
            message: failure.message,
            personId,
            sessionId,
          }),
        onSuccess: () => Message.DispatchedClipboard(),
      })
    ),
  messages: [Message.DispatchedClipboard, Message.FailedClipboard],
});

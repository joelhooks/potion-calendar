import type {
  AgendaKeyValue,
  AgendaSnapshotValue,
  PromptAction,
} from "@calendar/core/desktop-bridge";
import { send } from "@xstate/effect";
import type { EffectActor } from "@xstate/effect";
import { Clock, Effect } from "effect";

import type { DesktopError } from "./config.js";
import { promptEmailUrl } from "./prompt-email.js";
import type { promptMachine } from "./prompt-machine.js";
import { promptIdentity } from "./prompt-model.js";

export const openPromptAttachment = Effect.fn("Desktop.openPromptAttachment")((
  action: Extract<typeof PromptAction.Type, { readonly action: "attachment" }>,
  agenda: AgendaSnapshotValue,
  open: (url: string) => Effect.Effect<void, DesktopError>
) => {
  const saved = agenda.events.find(
    (event) => promptIdentity(event.key) === promptIdentity(action.key)
  );

  const attachment = saved?.attachments?.[action.index];

  return attachment === undefined || attachment.url !== action.url
    ? Effect.void
    : open(attachment.url);
});

export const requestPromptSnooze = Effect.fn("Desktop.requestPromptSnooze")(
  function* requestPromptSnooze(
    prompt: EffectActor<ReturnType<typeof promptMachine>>,
    key: AgendaKeyValue
  ) {
    yield* send(prompt, {
      key,
      now: yield* Clock.currentTimeMillis,
      type: "Snooze",
    });
  }
);

export const emailPromptParticipants = Effect.fn(
  "Desktop.emailPromptParticipants"
)((
  key: AgendaKeyValue,
  agenda: AgendaSnapshotValue,
  open: (url: string) => Effect.Effect<void, DesktopError>
) => {
  const saved = agenda.events.find(
    (event) => promptIdentity(event.key) === promptIdentity(key)
  );

  const href = saved === undefined ? undefined : promptEmailUrl(saved);

  return href === undefined ? Effect.void : open(href);
});

import type {
  AgendaEventValue,
  PromptAction,
} from "@calendar/core/desktop-bridge";
import { Match } from "effect";

import { NativeIntent } from "./native-host.js";
import type { NativeIntentValue } from "./native-host.js";

export const promptActionIntent = (
  action: typeof PromptAction.Type,
  event: AgendaEventValue
): NativeIntentValue | undefined =>
  action.action === "attachment"
    ? NativeIntent.cases.OpenPromptAttachment.make({
        index: action.index,
        key: event.key,
        url: action.url,
      })
    : Match.value(action.action).pipe(
        Match.when("join", () =>
          event.conferenceUrl === null
            ? undefined
            : NativeIntent.cases.Join.make({
                request: { conferenceUrl: event.conferenceUrl, key: event.key },
              })
        ),
        Match.when("show", () =>
          NativeIntent.cases.ShowEvent.make({ key: event.key })
        ),
        Match.when("dismiss", () =>
          NativeIntent.cases.DismissPrompt.make({ key: event.key })
        ),
        Match.when("email", () =>
          NativeIntent.cases.EmailPrompt.make({ key: event.key })
        ),
        Match.when("snooze", () =>
          NativeIntent.cases.SnoozePrompt.make({ key: event.key })
        ),
        Match.exhaustive
      );

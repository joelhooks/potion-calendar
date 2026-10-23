import { Effect, Schema } from "effect";
import { Command, Render } from "foldkit";

import { Message } from "../message.js";
import { reminderSnoozeElementId } from "./model.js";

export const revealReminderSnooze = (element: HTMLDetailsElement): void => {
  const stack = element.closest<HTMLElement>(".reminder-cards");

  if (!element.open || stack === null) {
    return;
  }

  const bounds = stack.getBoundingClientRect();
  const disclosure = element.getBoundingClientRect();
  const top = bounds.top + stack.clientTop;
  const bottom = top + stack.clientHeight;

  if (disclosure.bottom > bottom) {
    stack.scrollTop += disclosure.bottom - bottom;
  } else if (disclosure.top < top) {
    stack.scrollTop -= top - disclosure.top;
  }
};

export const RevealReminderSnooze = Command.define("RevealReminderSnooze", {
  args: { id: Schema.String, personId: Schema.String },
  execute: ({ id, personId }) =>
    Render.afterCommit.pipe(
      Effect.andThen(
        Effect.sync(() => {
          const element = [
            ...document.querySelectorAll<HTMLDetailsElement>(
              "details.reminder-snooze"
            ),
          ].find(
            (candidate) =>
              candidate.id === reminderSnoozeElementId(personId, id)
          );

          if (element !== undefined) {
            revealReminderSnooze(element);
          }

          return Message.ReminderEffectCompleted();
        })
      )
    ),
  messages: [Message.ReminderEffectCompleted],
});

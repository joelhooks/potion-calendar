import { setupEffect } from "@xstate/effect";
import { Schema } from "effect";
import { initialTransition, transition } from "xstate";

import { conferenceLink } from "../../layout/conferencing.js";
import type {
  NotificationContentValue,
  ReminderCandidateValue,
  ReminderCard,
} from "./model.js";

export const reminderOccurrence = (
  personId: string,
  candidate: ReminderCandidateValue
): string => JSON.stringify([personId, candidate.identity, candidate.start]);

export const reminderCardExpired = (
  notification: NotificationContentValue,
  now: number
): boolean =>
  notification.card?.kind === "upcoming" &&
  Math.floor((now - notification.candidate.start) / 60_000) > 15;

const ArbitrationInput = Schema.Struct({ upcoming: Schema.Boolean });

export const reminderCardMachine = setupEffect({
  schemas: {
    context: ArbitrationInput,
    events: { EXPIRE: Schema.Struct({}), RESOLVE: Schema.Struct({}) },
    input: ArbitrationInput,
  },
}).createMachine({
  context: ({ input }) => input,
  initial: "arbitrating",
  states: {
    arbitrating: {
      always: ({ context }) => ({
        target: context.upcoming ? "upcoming" : "reminder",
      }),
    },
    reminder: {
      on: { EXPIRE: { target: "resolved" }, RESOLVE: { target: "resolved" } },
    },
    resolved: { type: "final" },
    upcoming: {
      on: { EXPIRE: { target: "resolved" }, RESOLVE: { target: "resolved" } },
    },
  },
});

export const arbitrateReminder = (
  notification: NotificationContentValue,
  now: number,
  dismissed: readonly string[]
): NotificationContentValue => {
  const { candidate } = notification;
  const { event } = candidate;

  const upcoming =
    event.start !== undefined &&
    !("date" in event.start) &&
    (event.attendees?.length ?? 0) > 0 &&
    conferenceLink(event.conferenceUrl, event.description, event.location) !==
      undefined &&
    Math.floor(now / 60_000) <= Math.floor(candidate.start / 60_000) &&
    Math.floor(now / 60_000) >= Math.floor(candidate.start / 60_000) - 1 &&
    !dismissed.includes(reminderOccurrence(notification.personId, candidate));

  const [snapshot] = initialTransition(reminderCardMachine, { upcoming });
  const kind = snapshot.matches("upcoming") ? "upcoming" : "reminder";

  return {
    ...notification,
    card: { kind, state: "active" },
    title: `${kind === "upcoming" ? "Upcoming meeting" : "Reminder"}: ${candidate.title}`,
  };
};

export const resolveReminderCard = (
  card: typeof ReminderCard.Type,
  event: "RESOLVE" | "EXPIRE" = "RESOLVE"
): typeof ReminderCard.Type => {
  const snapshot = reminderCardMachine.resolveState({
    context: { upcoming: card.kind === "upcoming" },
    value: card.state === "resolved" ? "resolved" : card.kind,
  });

  const [next] = transition(reminderCardMachine, snapshot, { type: event });

  return { ...card, state: next.matches("resolved") ? "resolved" : "active" };
};

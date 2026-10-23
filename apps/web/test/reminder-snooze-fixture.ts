import { Option } from "effect";
import { AsyncData } from "foldkit";

import { Message, update } from "../src/client/app.js";
import { ReminderSnoozeRestore } from "../src/client/reminders/model.js";
import { reminderCardScene } from "./reminder-card-fixture.js";

export const reminderSnoozeFixture = (
  theme: "light" | "dark",
  width: number,
  started: boolean,
  failed = false
) => {
  const base = reminderCardScene(
    "reminder",
    theme,
    width,
    "granted",
    "unavailable",
    failed ? "failed" : "ready"
  );

  const personId = Option.getOrThrow(base.before.person);
  const saved = Option.getOrThrow(AsyncData.getData(base.before.upcoming.data));
  const [event] = saved.events;

  if (event === undefined) {
    throw new Error("Missing snooze fixture source event");
  }

  const events =
    width === 390
      ? [
          {
            ...event,
            eventId: `${event.eventId}:first`,
            iCalUID: "snooze-first",
            title: "Read the release checklist",
          },
          {
            ...event,
            eventId: `${event.eventId}:second`,
            iCalUID: "snooze-second",
            title: "Prepare the project notes",
          },
          event,
        ]
      : [event];

  const accepted = update(
    base.before,
    Message.ReceivedUpcoming({
      personId,
      request: base.before.upcoming.request,
      result: { ...saved, events },
    })
  ).model;

  const due = update(
    accepted,
    Message.Ticked({ now: base.model.calendar.now })
  ).model;

  const restored = update(
    due,
    Message.ReminderSnoozesRestored({
      outcome: ReminderSnoozeRestore.cases.Restored.make({ entries: [] }),
      personId,
    })
  ).model;

  const current = started
    ? update(restored, Message.Ticked({ now: restored.calendar.now + 60_001 }))
        .model
    : restored;

  const measured = update(
    current,
    Message.MeasuredShellViewport({ width })
  ).model;

  return {
    ...measured,
    calendar: {
      ...measured.calendar,
      viewport: 700,
      viewportWidth:
        width <= 640 ? width - 68 : width - (width <= 1000 ? 445 : 520),
    },
  };
};

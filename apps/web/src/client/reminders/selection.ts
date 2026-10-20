import { Option, Predicate } from "effect";

import { dayFromIso, dayInZone, visibleDays } from "../../layout/navigation.js";
import { visibleEvents } from "../../layout/presentation.js";
import { CalendarRoute } from "../../layout/route.js";
import type { AppModel, update } from "../app.js";
import { eventKey } from "../calendar-state.js";
import { closeKeyboard } from "../keyboard/update.js";
import { Message } from "../message.js";
import type { AppMessage } from "../message.js";
import type { NotificationContentValue } from "./model.js";
import { reminderSnapshot } from "./source.js";

type Result = ReturnType<typeof update>;

export const selectReminderNotification = (
  model: AppModel,
  notification: NotificationContentValue,
  apply: (model: AppModel, message: AppMessage) => Result
): Result => {
  if (!Option.contains(model.person, notification.personId)) {
    return { model };
  }

  const active = model.reminders.context.active.find(
    (entry) => entry.id === notification.id
  );

  const target = reminderSnapshot(model)?.candidates.find(
    (candidate) => candidate.identity === active?.candidate.identity
  );

  if (target === undefined) {
    return { model };
  }

  const key = model.calendar.mergeDuplicates
    ? target.key
    : eventKey(target.event);

  const day =
    target.event.start !== undefined && "date" in target.event.start
      ? dayFromIso(target.event.start.date)
      : dayInZone(target.start, model.calendar.zone);

  const route: Result = Predicate.isTagged(model.route, "Calendar")
    ? { model: closeKeyboard(model) }
    : apply(
        model,
        Message.RequestedRoute({
          replace: false,
          route: CalendarRoute.make({}),
        })
      );

  const existing =
    visibleDays(route.model.calendar.navigation).includes(day) &&
    visibleEvents(route.model).some((event) => event.key === key);

  const position: Result = existing
    ? { model: route.model }
    : apply(route.model, Message.KeyboardDate({ day }));

  const selected = apply(position.model, Message.ClickedEvent({ key }));

  return {
    ...selected,
    commands: [
      ...(route.commands ?? []),
      ...(position.commands ?? []),
      ...(selected.commands ?? []),
    ],
  };
};

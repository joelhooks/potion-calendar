import {
  NativeNotificationNotice,
  sameDesktopEventKey,
} from "@calendar/core/desktop-bridge";
import { Option } from "effect";

import type { AppModel, update } from "../app.js";
import { respondForSavedEvent } from "../desktop/respond.js";
import type { AppMessage } from "../message.js";
import { acceptedReminderCandidates } from "./accepted-candidates.js";
import { nativeNotificationLease } from "./native-projection.js";
import { selectReminderNotification } from "./selection.js";
import { commitReminders } from "./update.js";

type Result = ReturnType<typeof update>;

const passiveNativeNotice = (
  notice: typeof NativeNotificationNotice.Type
): boolean =>
  NativeNotificationNotice.guards.Shown(notice) ||
  NativeNotificationNotice.guards.Closed(notice) ||
  NativeNotificationNotice.guards.Reply(notice);

export const actOnNativeNotification = (
  model: AppModel,
  notice: typeof NativeNotificationNotice.Type,
  apply: (model: AppModel, message: AppMessage) => Result
): Result => {
  const { ref } = notice;

  if (
    nativeNotificationLease(model) !== ref.lease ||
    !Option.contains(model.person, ref.personId) ||
    ref.revision > (model.desktop.notificationRevision ?? 0)
  ) {
    return { model };
  }

  const active = model.reminders.context.active.find(
    (entry) =>
      entry.id === ref.id &&
      entry.personId === ref.personId &&
      entry.nativeKind === ref.kind &&
      entry.candidate.start === ref.start
  );

  const candidate = acceptedReminderCandidates(model).find(
    (item) =>
      item.start === ref.start &&
      sameDesktopEventKey(item.event, ref.key) &&
      item.end > model.calendar.now
  );

  if (active === undefined || candidate === undefined) {
    return { model };
  }

  if (passiveNativeNotice(notice)) {
    return { model };
  }

  let result: Result = { model };

  if (
    NativeNotificationNotice.guards.Clicked(notice) ||
    (NativeNotificationNotice.guards.ActionSelected(notice) &&
      notice.action === "show")
  ) {
    result = selectReminderNotification(model, { ...active, candidate }, apply);
  } else if (
    NativeNotificationNotice.guards.ActionSelected(notice) &&
    (notice.action === "accepted" ||
      notice.action === "declined" ||
      notice.action === "tentative")
  ) {
    if (ref.kind !== "invite") {
      return { model };
    }

    result = respondForSavedEvent(model, candidate.event, notice.action);
  }

  const resolved = commitReminders(result.model, {
    ...result.model.reminders,
    context: {
      ...result.model.reminders.context,
      active: result.model.reminders.context.active.filter(
        (entry) => entry.id !== ref.id
      ),
      close: [ref.id],
      deliveries: [],
    },
    failure: NativeNotificationNotice.guards.Failed(notice)
      ? Option.some(
          "A desktop notification could not be shown. Check Calendar in system notification settings."
        )
      : result.model.reminders.failure,
  });

  return {
    ...resolved,
    commands: [...(result.commands ?? []), ...(resolved.commands ?? [])],
  };
};

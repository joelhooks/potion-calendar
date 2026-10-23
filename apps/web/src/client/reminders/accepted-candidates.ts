import { Option } from "effect";
import { AsyncData } from "foldkit";

import { resolvedTimeFormat } from "../../layout/time-format.js";
import type { AppModel } from "../app.js";
import { reminderCandidates } from "./candidates.js";
import {
  liveSnoozeIdentities,
  reminderEventIdentity,
} from "./snooze-identities.js";

export const acceptedReminderCandidates = (model: AppModel) => {
  const saved = AsyncData.getData(model.upcoming.data);
  const session = Option.getOrUndefined(AsyncData.getData(model.session));
  const accounts = session?.accounts ?? [];

  const primaryAccount =
    accounts.find((account) => account.email === session?.user.email)?.id ??
    accounts[0]?.id;

  const live = liveSnoozeIdentities(model.reminders.context);

  return reminderCandidates({
    accounts: accounts.map((account) => account.id),
    calendars: model.calendar.calendars,
    events: [
      ...(model.upcoming.reminderEvents ?? []).filter((event) =>
        live.has(reminderEventIdentity(event))
      ),
      ...(Option.isSome(saved) ? saved.value.events : []),
    ],
    format: resolvedTimeFormat(model),
    hidden: model.calendar.hidden,
    now: model.calendar.now,
    primaryAccount,
    zone: model.calendar.zone,
  });
};

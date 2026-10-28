import { Option } from "effect";
import { AsyncData } from "foldkit";

import { resolvedAppLocale } from "../../layout/app-locale.js";
import { primaryAccountId } from "../../layout/primary-account.js";
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

  const primaryAccount = primaryAccountId(session);

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
    locale: resolvedAppLocale(model),
    now: model.calendar.now,
    primaryAccount,
    zone: model.calendar.zone,
  });
};

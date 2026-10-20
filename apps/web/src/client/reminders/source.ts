import { Option } from "effect";
import { AsyncData } from "foldkit";

import { resolvedTimeFormat } from "../../layout/time-format.js";
import type { AppModel } from "../app.js";
import { upcomingSelection } from "../upcoming/update.js";
import { reminderCandidates } from "./candidates.js";
import type { ReminderScan } from "./model.js";

export const reminderSnapshot = (
  model: AppModel
): typeof ReminderScan.Type | undefined => {
  if (Option.isNone(model.person)) {
    return undefined;
  }

  const saved = AsyncData.getData(model.upcoming.data);
  const session = Option.getOrUndefined(AsyncData.getData(model.session));
  const accounts = session?.accounts ?? [];

  const primaryAccount =
    accounts.find((account) => account.email === session?.user.email)?.id ??
    accounts[0]?.id;

  return {
    accepted: Option.isSome(saved) ? model.upcoming.accepted : Option.none(),
    candidates: reminderCandidates({
      accounts: accounts.map((account) => account.id),
      calendars: model.calendar.calendars,
      events: Option.isSome(saved) ? saved.value.events : [],
      format: resolvedTimeFormat(model),
      hidden: model.calendar.hidden,
      now: model.calendar.now,
      primaryAccount,
      zone: model.calendar.zone,
    }),
    eventInvites: model.settings.eventInvites,
    now: model.calendar.now,
    personId: model.person.value,
    scope: JSON.stringify([model.person.value, upcomingSelection(model)]),
  };
};

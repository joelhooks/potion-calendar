import { Option } from "effect";
import { AsyncData } from "foldkit";

import type { AppModel } from "../client/app.js";
import { calendarKey } from "../client/calendar-state.js";

export const calendarReadFailures = (model: AppModel) =>
  model.calendar.calendars.flatMap((calendar) => {
    const key = calendarKey(calendar.accountId, calendar.calendarId);

    if (model.calendar.hidden.includes(key)) {
      return [];
    }

    const read = model.calendar.reads.find(
      (item) => item.accountId === calendar.accountId
    );

    const error =
      read === undefined ? Option.none() : AsyncData.getError(read.events);

    if (
      read === undefined ||
      Option.isNone(error) ||
      error.value.kind === "reconnect"
    ) {
      return [];
    }

    const data = AsyncData.getData(read.events);

    const cached =
      Option.isSome(data) &&
      [...data.value.versions, ...data.value.events].some(
        (item) =>
          item.accountId === calendar.accountId &&
          item.calendarId === calendar.calendarId
      );

    return [{ cached, calendar, key }];
  });

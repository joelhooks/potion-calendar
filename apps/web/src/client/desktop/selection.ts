import type { CalendarEventValue } from "@calendar/calendar/contracts";
import type { AgendaKeyValue } from "@calendar/core/desktop-bridge";
import { Option } from "effect";
import { AsyncData } from "foldkit";

import { mergeEquivalentEvents } from "../../layout/equivalent-events.js";
import { displayEvent } from "../../layout/presentation.js";
import type { DisplayEvent } from "../../layout/presentation.js";
import type { AppModel } from "../app.js";
import { agendaSnapshot } from "./snapshot.js";

const sameKey = (left: AgendaKeyValue, right: AgendaKeyValue) =>
  left.accountId === right.accountId &&
  left.calendarId === right.calendarId &&
  left.eventId === right.eventId;

const displayedSelection = (
  model: AppModel,
  key: AgendaKeyValue,
  events: readonly CalendarEventValue[]
): DisplayEvent | undefined => {
  const displayed = events.flatMap((event) => {
    const calendar = model.calendar.calendars.find(
      (candidate) =>
        candidate.accountId === event.accountId &&
        candidate.calendarId === event.calendarId
    );

    const item =
      calendar === undefined
        ? undefined
        : displayEvent(event, calendar, model.calendar.zone, Option.none());

    return item === undefined ? [] : [item];
  });

  const session = Option.getOrUndefined(AsyncData.getData(model.session));
  const accounts = session?.accounts ?? [];

  const primary =
    accounts.find((account) => account.email === session?.user.email)?.id ??
    accounts[0]?.id;

  const candidates = model.calendar.mergeDuplicates
    ? mergeEquivalentEvents(
        displayed,
        accounts.map((account) => account.id),
        primary
      )
    : displayed;

  return candidates.find((item) =>
    item.copies.some((copy) => sameKey(copy.source, key))
  );
};

export const desktopSelection = (
  model: AppModel,
  key: AgendaKeyValue
): DisplayEvent | undefined => {
  const settings = AsyncData.getData(model.desktop.settings);
  const upcoming = AsyncData.getData(model.upcoming.data);

  return Option.isSome(settings) &&
    Option.isSome(upcoming) &&
    agendaSnapshot(model, settings.value.preferences).events.some((event) =>
      sameKey(event.key, key)
    )
    ? displayedSelection(model, key, upcoming.value.events)
    : undefined;
};

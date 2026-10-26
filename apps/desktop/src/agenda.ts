import type {
  AgendaEventValue,
  AgendaSnapshotValue,
  DesktopPreferencesValue,
} from "@calendar/core/desktop-bridge";

export const singleLine = (title: string) => title.replaceAll(/\s+/gu, " ");

const minuteMilliseconds = 60_000;

const dayMilliseconds = 24 * 60 * minuteMilliseconds;

const includedEvents = (
  snapshot: AgendaSnapshotValue,
  preferences: DesktopPreferencesValue,
  now: number
): readonly AgendaEventValue[] =>
  preferences.menuBar
    ? snapshot.events
        .filter(
          (event) =>
            event.end > now &&
            event.responseStatus !== "declined" &&
            (!event.allDay || preferences.includeAllDay) &&
            (event.hasParticipants || preferences.includeWithoutParticipants) &&
            (event.conferenceUrl !== null ||
              event.hasLocation ||
              preferences.includeWithoutConferencingOrLocation)
        )
        .toSorted(
          (left, right) =>
            left.start - right.start ||
            left.key.eventId.localeCompare(right.key.eventId)
        )
    : [];

export const menuAgenda = (
  snapshot: AgendaSnapshotValue,
  preferences: DesktopPreferencesValue,
  now: number
): readonly AgendaEventValue[] =>
  includedEvents(snapshot, preferences, now).filter(
    (event) => event.start < now + preferences.includeDays * dayMilliseconds
  );

const completeKeyOrder = (left: AgendaEventValue, right: AgendaEventValue) =>
  left.key.accountId.localeCompare(right.key.accountId) ||
  left.key.calendarId.localeCompare(right.key.calendarId) ||
  left.key.eventId.localeCompare(right.key.eventId);

export const sameAgendaKey = (
  left: AgendaEventValue["key"],
  right: AgendaEventValue["key"]
): boolean =>
  left.accountId === right.accountId &&
  left.calendarId === right.calendarId &&
  left.eventId === right.eventId;

export const trayAgenda = (
  snapshot: AgendaSnapshotValue,
  preferences: DesktopPreferencesValue,
  now: number
) => {
  const events = menuAgenda(snapshot, preferences, now);

  const [current] = events
    .filter((event) => !event.allDay)
    .toSorted(
      (left, right) => left.start - right.start || completeKeyOrder(left, right)
    );

  return {
    current,
    remaining:
      current === undefined
        ? events
        : events.filter((event) => !sameAgendaKey(event.key, current.key)),
  };
};

export const previewMeeting = (
  snapshot: AgendaSnapshotValue,
  preferences: DesktopPreferencesValue,
  now: number
): AgendaEventValue | undefined =>
  preferences.showTitle || preferences.showTime
    ? includedEvents(snapshot, preferences, now).find(
        (event) =>
          event.start <= now + preferences.previewMinutes * minuteMilliseconds
      )
    : undefined;

export const previewLabel = (
  snapshot: AgendaSnapshotValue,
  preferences: DesktopPreferencesValue,
  now: number,
  formatTime: (value: number) => string
): string => {
  const preview = previewMeeting(snapshot, preferences, now);

  return preview === undefined
    ? ""
    : [
        preferences.showTime ? formatTime(preview.start) : "",
        preferences.showTitle ? singleLine(preview.title).slice(0, 90) : "",
      ]
        .filter((part) => part.length > 0)
        .join(" ");
};

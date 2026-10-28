import { Option } from "effect";

import { conferenceLink } from "../../layout/conferencing.js";
import {
  arbitrateReminder,
  reminderCardExpired,
  reminderOccurrence,
  resolveReminderCard,
} from "./action-machine.js";
import {
  eligibleNotificationEvent,
  eligibleReminder,
  eligibleSnoozedReminder,
} from "./candidates.js";
import type {
  ReminderCandidateValue,
  ReminderMemory,
  ReminderScan,
  NotificationContentValue,
} from "./model.js";

type Memory = typeof ReminderMemory.Type;

type Scan = typeof ReminderScan.Type & {
  readonly native?: boolean;
  readonly nativeEnabled?: boolean;
};

type Invitation = Memory["invitations"][string];

const selfResponse = (candidate: ReminderCandidateValue) =>
  candidate.event.attendees?.find((attendee) => attendee.self === true);

const version = (candidate: ReminderCandidateValue): string =>
  JSON.stringify({
    conferencing: conferenceLink(
      candidate.event.conferenceUrl,
      candidate.event.description,
      candidate.event.location
    ),
    end:
      candidate.event.end !== undefined && "date" in candidate.event.end
        ? candidate.event.end.date
        : candidate.end,
    location: candidate.event.location ?? "",
    start:
      candidate.event.start !== undefined && "date" in candidate.event.start
        ? candidate.event.start.date
        : candidate.start,
    title: candidate.title,
  });

const invitationsIn = (
  candidates: readonly ReminderCandidateValue[]
): Memory["invitations"] =>
  Object.fromEntries(
    candidates.flatMap((candidate) => {
      const self = selfResponse(candidate);

      if (
        self === undefined ||
        candidate.event.organizer?.self === true ||
        self.organizer === true
      ) {
        return [];
      }

      const observed: Invitation = {
        answered:
          self.responseStatus === "accepted" ||
          self.responseStatus === "tentative",
        version: version(candidate),
      };

      return [[candidate.identity, observed]];
    })
  );

const popupNotifications = (
  scan: Scan,
  floor: number,
  candidates: readonly ReminderCandidateValue[]
): NotificationContentValue[] =>
  candidates.flatMap((candidate) => {
    const { reminders } = candidate.event;

    if (reminders === undefined) {
      return [];
    }

    const offsets = reminders.useDefault
      ? (candidate.calendar.defaultReminders ?? [])
      : (reminders.overrides ?? []);

    return offsets
      .filter(
        (reminder) =>
          reminder.method === "popup" &&
          candidate.start - reminder.minutes * 60_000 > floor &&
          candidate.start - reminder.minutes * 60_000 <= scan.now
      )
      .map((reminder) => ({
        candidate,
        id: JSON.stringify(["popup", candidate.identity, reminder.minutes]),
        personId: scan.personId,
        title: candidate.title,
      }));
  });

const invitationNotifications = (
  receipt: { readonly personId: string; readonly request: number },
  candidates: readonly ReminderCandidateValue[],
  previous: Memory["invitations"],
  current: Memory["invitations"]
): NotificationContentValue[] =>
  candidates.flatMap((candidate) => {
    const before = previous[candidate.identity];
    const after = current[candidate.identity];
    const self = selfResponse(candidate);

    if (
      after === undefined ||
      !(
        (before === undefined && self?.responseStatus === "needsAction") ||
        (before?.answered === true && before.version !== after.version)
      )
    ) {
      return [];
    }

    return [
      {
        candidate,
        id: JSON.stringify(["invite", candidate.identity, receipt.request]),
        personId: receipt.personId,
        title: `Invite: ${candidate.title}`,
      },
    ];
  });

const readMemory = (
  memory: Memory,
  scan: Scan,
  fresh: boolean,
  sameScope: boolean,
  checked: number,
  invitations: Memory["invitations"]
) => {
  if (fresh && Option.isSome(scan.accepted)) {
    return {
      accepted: Option.some(scan.accepted.value.request),
      coverage: Option.some(checked),
      invitations,
    };
  }

  if (sameScope) {
    return {
      accepted: memory.accepted,
      coverage:
        scan.native === true && scan.nativeEnabled !== true
          ? Option.some(checked)
          : memory.coverage,
      invitations: memory.invitations,
    };
  }

  return { accepted: Option.none(), coverage: Option.none(), invitations: {} };
};

const snoozeSurfaceActive = (scan: Scan): boolean =>
  scan.webCards === true ||
  (scan.native === true && scan.nativeEnabled === true);

export const planReminders = (memory: Memory, scan: Scan): Memory => {
  const permitted =
    scan.native === true
      ? scan.nativeEnabled === true
      : memory.permission === "granted";

  const candidates = scan.candidates.filter((candidate) =>
    eligibleNotificationEvent(candidate, scan.now)
  );

  const snoozes = memory.snoozes ?? [];
  const pendingIdentities = new Set(snoozes.map((entry) => entry.identity));

  const retainedIdentities = new Set([
    ...pendingIdentities,
    ...memory.active
      .filter(
        (entry) =>
          entry.card?.snoozedUntil !== undefined ||
          entry.nativeSnoozedUntil !== undefined
      )
      .map((entry) => entry.candidate.identity),
  ]);

  const current = new Map(
    scan.candidates
      .filter(
        (candidate) =>
          eligibleNotificationEvent(candidate, scan.now) ||
          (retainedIdentities.has(candidate.identity) &&
            eligibleSnoozedReminder(candidate))
      )
      .map((candidate) => [candidate.identity, candidate])
  );

  const dueSnoozes = snoozeSurfaceActive(scan)
    ? snoozes.filter(
        (entry) =>
          entry.due <= scan.now &&
          (scan.snoozeRangeReady !== false || current.has(entry.identity))
      )
    : [];

  const snoozeProposals: NotificationContentValue[] = dueSnoozes.flatMap(
    (entry) => {
      const candidate = current.get(entry.identity);

      return candidate === undefined
        ? []
        : [
            {
              candidate,
              ...(scan.native === true
                ? {
                    nativeKind: "reminder" as const,
                    nativeSnoozedUntil: entry.due,
                  }
                : {
                    card: {
                      kind: "reminder" as const,
                      snoozedUntil: entry.due,
                      state: "active" as const,
                    },
                  }),
              id: JSON.stringify(["snooze", entry.identity, entry.due]),
              personId: scan.personId,
              title: `Reminder: ${candidate.title}`,
            },
          ];
    }
  );

  const snoozeIds = new Set(snoozeProposals.map((entry) => entry.id));

  const active = memory.active.flatMap((notification) => {
    const candidate = current.get(notification.candidate.identity);

    if (
      (!permitted && notification.card === undefined) ||
      (notification.card !== undefined &&
        (scan.webCards !== true ||
          pendingIdentities.has(notification.candidate.identity))) ||
      reminderCardExpired(notification, scan.now) ||
      candidate === undefined ||
      (notification.card !== undefined &&
        notification.candidate.start !== candidate.start)
    ) {
      const card =
        notification.card === undefined
          ? undefined
          : resolveReminderCard(notification.card, "EXPIRE");

      return card?.state === "active" ? [notification] : [];
    }

    return [{ ...notification, candidate }];
  });

  const activeIds = new Set(active.map((notification) => notification.id));

  const close = memory.active
    .filter((notification) => !activeIds.has(notification.id))
    .map((notification) => notification.id);

  const highWater = Option.getOrElse(memory.lastChecked, () => scan.now);
  const checked = Math.max(highWater, scan.now);
  const sameScope = memory.scope === scan.scope;

  const fresh =
    Option.isSome(scan.accepted) &&
    (!sameScope ||
      !Option.contains(memory.accepted, scan.accepted.value.request));

  const baseline = sameScope && Option.isSome(memory.accepted);

  const floor =
    fresh && sameScope && Option.isSome(memory.coverage)
      ? Math.min(highWater, memory.coverage.value)
      : highWater;

  const invitations = invitationsIn(candidates);

  const pendingPopups =
    (permitted || scan.webCards === true) &&
    scan.now >= highWater &&
    Option.isSome(scan.accepted)
      ? popupNotifications(
          scan,
          floor,
          candidates.filter((candidate) =>
            eligibleReminder(candidate, scan.now)
          )
        )
      : [];

  const proposals: NotificationContentValue[] = pendingPopups.map(
    (notification) =>
      scan.native === true
        ? { ...notification, nativeKind: "reminder" }
        : notification
  );

  const popupIds = new Set(proposals.map((notification) => notification.id));
  proposals.unshift(...snoozeProposals);

  if (
    permitted &&
    scan.eventInvites &&
    baseline &&
    fresh &&
    Option.isSome(scan.accepted) &&
    scan.accepted.value.origin === "live"
  ) {
    proposals.push(
      ...invitationNotifications(
        { personId: scan.personId, request: scan.accepted.value.request },
        candidates,
        memory.invitations,
        invitations
      ).map((notification) =>
        scan.native === true
          ? { ...notification, nativeKind: "invite" as const }
          : notification
      )
    );
  }

  const fired = new Set(memory.fired);

  const selected = new Set<string>();

  const deliveries = proposals.flatMap((notification) => {
    if (fired.has(notification.id)) {
      return [];
    }

    fired.add(notification.id);

    if (
      popupIds.has(notification.id) &&
      pendingIdentities.has(notification.candidate.identity)
    ) {
      return [];
    }

    if (snoozeIds.has(notification.id)) {
      const occurrence = reminderOccurrence(
        notification.personId,
        notification.candidate
      );

      if (selected.has(occurrence)) {
        return [];
      }

      selected.add(occurrence);

      return [notification];
    }

    if (scan.native === true && popupIds.has(notification.id)) {
      const occurrence = reminderOccurrence(
        notification.personId,
        notification.candidate
      );

      if (selected.has(occurrence)) {
        return [];
      }

      selected.add(occurrence);

      return [notification];
    }

    if (scan.webCards !== true || !popupIds.has(notification.id)) {
      return [notification];
    }

    const occurrence = reminderOccurrence(
      notification.personId,
      notification.candidate
    );

    if (selected.has(occurrence)) {
      return [];
    }

    selected.add(occurrence);

    return [
      arbitrateReminder(notification, scan.now, memory.dismissedPrompts ?? []),
    ];
  });

  const replaced = active.filter(
    (notification) =>
      (notification.card !== undefined ||
        notification.nativeKind === "reminder") &&
      selected.has(
        reminderOccurrence(notification.personId, notification.candidate)
      )
  );

  const replacedIds = new Set(replaced.map((notification) => notification.id));

  return {
    ...memory,
    ...readMemory(memory, scan, fresh, sameScope, checked, invitations),
    active: [
      ...active.filter((notification) => !replacedIds.has(notification.id)),
      ...deliveries,
    ],
    close: [...close, ...replacedIds],
    deliveries,
    fired: [...fired],
    lastChecked: Option.some(checked),
    scope: scan.scope,
    snoozes: snoozes.filter((entry) => !dueSnoozes.includes(entry)),
  };
};

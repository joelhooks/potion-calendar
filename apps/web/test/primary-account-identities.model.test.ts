import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { AsyncData } from "foldkit";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { savedMeetings } from "../src/client/meetings/source.js";
import { acceptedReminderCandidates } from "../src/client/reminders/accepted-candidates.js";
import { stepReminder } from "../src/client/reminders/machine.js";
import { ReminderSnoozeStorage } from "../src/client/reminders/model.js";
import { reminderSnapshot } from "../src/client/reminders/source.js";
import {
  ProfileChange,
  ProfileReply,
} from "../src/client/settings/profile/model.js";
import {
  UpcomingQuery,
  UpcomingReceipt,
} from "../src/client/upcoming/model.js";
import { upcomingSelection } from "../src/client/upcoming/update.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { primaryAccountFixture } from "./primary-account-fixture.js";
import { profileChange, profileSnapshot } from "./profile-fixture.js";
import {
  reminderEpoch,
  reminderEvent,
  reminderInstant,
  startedReminders,
} from "./reminders-fixture.js";

it.effect.each(["active", "snoozed"] as const)(
  "changing primary updates every representative but preserves equivalent keys and %s reminder identities without replay",
  (kind) =>
    Effect.sync(() => {
      const base = primaryAccountFixture();

      const firstEvent = reminderEvent(0, {
        accountId: "work",
        attendees: [
          {
            email: "owner@example.test",
            responseStatus: "accepted",
            self: true,
          },
        ],
        calendarId: "primary",
        conferenceUrl: "https://meet.google.com/abc-defg-hij",
      });

      const events = [
        firstEvent,
        {
          ...firstEvent,
          accountId: "personal",
          calendarId: "personal",
          eventId: "personal-copy",
        },
      ];

      const data = AsyncData.Success({ data: { events, versions: [] } });

      const source: AppModel = {
        ...base,
        calendar: {
          ...base.calendar,
          calendars: base.calendar.calendars.map((calendar) => ({
            ...calendar,
            timeZone: "UTC",
          })),
          mergeDuplicates: true,
          now: reminderEpoch + 50 * 60_000,
          reads: [{ accountId: "work", events: data }],
          zone: "UTC",
        },
        desktop: { ...base.desktop, availability: "unavailable" },
        upcoming: {
          ...base.upcoming,
          accepted: Option.some(
            UpcomingReceipt.make({ origin: "snapshot", request: 1 })
          ),
          data,
          query: Option.some(
            UpcomingQuery.make({
              calendars: upcomingSelection(base),
              origin: "snapshot",
              personId: Option.getOrThrow(base.person),
              range: {
                end: reminderInstant(7 * 1440),
                start: reminderInstant(-1441),
              },
              request: 1,
            })
          ),
          refreshAt: reminderEpoch + 100 * 60_000,
          request: 1,
        },
      };

      const candidates = acceptedReminderCandidates(source);
      expect(candidates).toHaveLength(1);
      const identity = candidates[0]?.identity;
      expect(identity).toBeDefined();

      if (identity === undefined) {
        return;
      }

      const scan = reminderSnapshot(source);
      expect(scan).toBeDefined();

      if (scan === undefined) {
        return;
      }

      const planned = stepReminder(startedReminders(), {
        ...scan,
        snoozeRangeReady: scan.snoozeRangeReady,
        type: "SCAN",
        webCards: true,
      });

      expect(planned.context.active).toHaveLength(1);
      expect(planned.context.fired).toHaveLength(1);

      const snoozes =
        kind === "snoozed"
          ? [{ due: source.calendar.now + 5 * 60_000, identity }]
          : [];

      const before = {
        ...source,
        calendar: { ...source.calendar, selected: [identity] },
        reminders: {
          ...planned,
          context: {
            ...planned.context,
            active: kind === "snoozed" ? [] : planned.context.active,
            deliveries: [],
            snoozeStorage: ReminderSnoozeStorage.cases.Ready.make({}),
            snoozes,
          },
        },
      };

      expect(
        visibleEvents(before).map((event) => event.source.accountId)
      ).toEqual(["work"]);
      expect(
        savedMeetings(before).map(
          (candidate) => candidate.item.source.accountId
        )
      ).toEqual(["work"]);

      const edited = profileChange(
        before,
        ProfileChange.cases.Primary.make({ accountId: "personal" })
      ).model;

      const saving = profileChange(
        edited,
        ProfileChange.cases.Save.make({})
      ).model;

      const after = update(
        saving,
        Message.ProfileCompleted({
          personId: profileSnapshot(before).user.id,
          reply: ProfileReply.cases.Saved.make({
            name: before.profile.savedName,
            primaryAccountId: "personal",
          }),
          sequence: saving.profile.sequence,
        })
      ).model;

      expect(
        visibleEvents(after).map((event) => ({
          account: event.source.accountId,
          copies: event.copies.length,
          key: event.key,
        }))
      ).toEqual([{ account: "personal", copies: 2, key: identity }]);
      expect(after.calendar.selected).toEqual([identity]);
      expect(
        savedMeetings(after).map((candidate) => ({
          account: candidate.item.source.accountId,
          key: candidate.item.key,
        }))
      ).toEqual([{ account: "personal", key: identity }]);
      expect(
        acceptedReminderCandidates(after).map((candidate) => ({
          account: candidate.event.accountId,
          identity: candidate.identity,
        }))
      ).toEqual([{ account: "personal", identity }]);
      expect(after.reminders.context.fired).toEqual(
        before.reminders.context.fired
      );
      expect(after.reminders.context.deliveries).toEqual([]);
      expect(after.reminders.context.snoozes).toEqual(snoozes);
      expect(after.reminders.context.active.map((entry) => entry.id)).toEqual(
        before.reminders.context.active.map((entry) => entry.id)
      );
      expect(
        after.reminders.context.active.every(
          (entry) =>
            entry.candidate.identity === identity &&
            entry.candidate.event.accountId === "personal"
        )
      ).toBe(true);
    })
);

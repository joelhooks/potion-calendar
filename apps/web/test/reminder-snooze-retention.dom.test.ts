import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Option, Stream } from "effect";
import { TestClock } from "effect/testing";
import { AsyncData } from "foldkit";
import { renderToString } from "foldkit/experimental/server";
import { afterEach, beforeEach, vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { eventKey } from "../src/client/calendar-state.js";
import { browserNotifications } from "../src/client/reminders/browser.js";
import { currentReminderCard } from "../src/client/reminders/card-selection.js";
import { initialReminderState } from "../src/client/reminders/machine.js";
import {
  NotificationEvent,
  ReminderSnoozeRestore,
  ReminderSnoozeStorage,
} from "../src/client/reminders/model.js";
import { NotificationPort } from "../src/client/reminders/port.js";
import {
  PersistReminderSnooze,
  RestoreReminderSnoozes,
  SampleReminderSnoozeClock,
} from "../src/client/reminders/snooze-commands.js";
import { reminderNotificationStream } from "../src/client/reminders/subscription.js";
import { view } from "../src/features/app.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { SearchRoute } from "../src/layout/route.js";
import { reminderCardScene } from "./reminder-card-fixture.js";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const longEndedCard = Effect.fn("longEndedSnoozeCard")(
  function* longEndedCard() {
    const base = reminderCardScene("reminder", "light", 1440).model;
    const [original] = base.reminders.context.active;

    if (original === undefined) {
      return yield* Effect.die(new Error("Missing original reminder"));
    }

    const due = base.calendar.now + 3_600_000;

    const notification = {
      ...original,
      card: {
        kind: "reminder" as const,
        snoozedUntil: due,
        state: "active" as const,
      },
      id: JSON.stringify(["snooze", original.candidate.identity, due]),
    };

    const model: AppModel = {
      ...base,
      reminders: {
        ...base.reminders,
        context: {
          ...base.reminders.context,
          active: [notification],
          snoozeStorage: ReminderSnoozeStorage.cases.Ready.make({}),
        },
      },
    };

    const advanced = update(
      model,
      Message.Ticked({ now: due + 2 * 86_400_000 })
    ).model;

    const empty = Option.getOrThrow(AsyncData.getData(advanced.upcoming.data));

    const refreshed = update(
      advanced,
      Message.ReceivedUpcoming({
        personId: original.personId,
        request: advanced.upcoming.request,
        result: { ...empty, events: [] },
      })
    ).model;

    return { model: refreshed, notification, original };
  }
);

it.effect(
  "a long-ended running-session snooze retains only reminder data across bounded refreshes and re-fires after another choice",
  () =>
    Effect.gen(function* repeatedPastSnooze() {
      const { model, original, notification } = yield* longEndedCard();
      const query = Option.getOrThrow(model.upcoming.query);

      expect(query.range.start).toBe(
        DateTime.formatIso(
          DateTime.makeUnsafe(model.calendar.now - 86_400_000 - 1)
        )
      );
      expect(model.upcoming.reminderEvents).toEqual([original.candidate.event]);
      expect(
        currentReminderCard(model, original.personId, notification.id)
      ).toBeDefined();
      expect(
        Option.getOrThrow(AsyncData.getData(model.upcoming.data)).events
      ).toEqual([]);

      const requested = update(
        model,
        Message.RequestedReminderSnooze({
          choice: 5,
          id: notification.id,
          personId: original.personId,
        })
      ).model;

      const entry = {
        due: model.calendar.now + 300_000,
        identity: original.candidate.identity,
      };

      yield* TestClock.setTime(model.calendar.now);

      const sampled = yield* SampleReminderSnoozeClock({
        choice: 5,
        id: notification.id,
        identity: original.candidate.identity,
        personId: original.personId,
      }).effect;

      const prepared = update(requested, sampled).model;

      const receipt = yield* PersistReminderSnooze({
        entry,
        id: notification.id,
        personId: original.personId,
      }).effect;

      const saved = update(prepared, receipt).model;
      const fired = update(saved, Message.Ticked({ now: entry.due })).model;

      expect(fired.reminders.context.active).toHaveLength(1);
      expect(fired.reminders.context.active[0]).toMatchObject({
        candidate: {
          body: original.candidate.body,
          title: original.candidate.title,
        },
        card: { snoozedUntil: entry.due },
      });
      expect(fired.reminders.context.snoozes).toEqual([]);
      const [active] = fired.reminders.context.active;

      if (active === undefined) {
        return yield* Effect.die(new Error("Missing repeated snooze"));
      }

      const dismissed = update(
        fired,
        Message.ReminderCardAction({
          action: "dismiss",
          id: active.id,
          personId: original.personId,
        })
      ).model;

      expect(dismissed.upcoming.reminderEvents).toEqual([]);

      return yield* Effect.void;
    })
);

it.effect.each(["update", "replacement", "cancel", "decline"] as const)(
  "a returned %s replaces retained history rather than resurrecting its old accepted payload",
  (kind) =>
    Effect.gen(function* returnedChange() {
      const { model, original } = yield* longEndedCard();

      expect(model.upcoming.reminderEvents).toHaveLength(1);

      let event = {
        ...original.candidate.event,
        title: "Updated accepted title",
      };

      if (kind === "replacement") {
        event = { ...event, eventId: "replacement-copy" };
      } else if (kind === "cancel") {
        event = { ...event, iCalUID: undefined, status: "cancelled" };
      } else if (kind === "decline") {
        event = {
          ...event,
          attendees: [
            {
              email: "person@example.test",
              responseStatus: "declined",
              self: true,
            },
          ],
        };
      }

      const saved = Option.getOrThrow(AsyncData.getData(model.upcoming.data));

      const result = update(
        model,
        Message.ReceivedUpcoming({
          personId: original.personId,
          request: model.upcoming.request,
          result: { ...saved, events: [event] },
        })
      ).model;

      expect(result.upcoming.reminderEvents).toEqual([]);
      expect(result.reminders.context.active).toHaveLength(
        kind === "update" || kind === "replacement" ? 1 : 0
      );

      if (kind === "update" || kind === "replacement") {
        expect(result.reminders.context.active[0]?.candidate.title).toBe(
          "Updated accepted title"
        );
      }
    })
);

it.effect(
  "retained accepted payloads never enter grid, details or search projections",
  () =>
    Effect.gen(function* reminderOnlyProjection() {
      const { model, original } = yield* longEndedCard();

      expect(model.upcoming.reminderEvents).toHaveLength(1);
      expect(
        visibleEvents(model).some(
          (event) => event.source.eventId === original.candidate.event.eventId
        )
      ).toBe(false);
      expect(
        Option.getOrThrow(AsyncData.getData(model.upcoming.data)).events
      ).toEqual([]);

      const selected = update(
        model,
        Message.ClickedEvent({
          key: model.calendar.mergeDuplicates
            ? original.candidate.key
            : eventKey(original.candidate.event),
        })
      ).model;

      const calendar = yield* renderToString(
        { init: () => ({ model: selected }), view },
        { isHydratable: false }
      );

      const calendarRoot = new DOMParser().parseFromString(
        calendar.html,
        "text/html"
      );

      expect(
        calendarRoot.querySelector(".detail-panel")?.textContent ?? ""
      ).not.toContain(original.candidate.title);

      const searching = {
        ...model,
        route: SearchRoute.make({ q: original.candidate.title }),
      };

      const search = yield* renderToString(
        { init: () => ({ model: searching }), view },
        { isHydratable: false }
      );

      const searchRoot = new DOMParser().parseFromString(
        search.html,
        "text/html"
      );

      expect(
        searchRoot.querySelector("#search-results")?.textContent ?? ""
      ).not.toContain(original.candidate.title);
      expect(searching.search).toBe(model.search);
      expect(
        calendarRoot.querySelector(".reminder-card")?.textContent
      ).toContain(original.candidate.title);
    })
);

it.effect.each([0, 1, 23, 24])(
  "a reload at %sh after event end resolves a future deadline even when that deadline is another day away",
  (hours) =>
    Effect.gen(function* restoreWithinBound() {
      const base = reminderCardScene(
        "reminder",
        "light",
        1440,
        "granted",
        "unavailable",
        "loading"
      ).model;

      const [original] = base.reminders.context.active;

      if (original === undefined) {
        return yield* Effect.die(new Error("Missing original reminder"));
      }

      const now = original.candidate.end + hours * 3_600_000;

      const entry = {
        due: now + 1440 * 60_000,
        identity: original.candidate.identity,
      };

      const saved = Option.getOrThrow(AsyncData.getData(base.upcoming.data));
      const queryBefore = Option.getOrThrow(base.upcoming.query);

      const fresh: AppModel = {
        ...base,
        calendar: { ...base.calendar, now },
        reminders: {
          ...base.reminders,
          context: { ...base.reminders.context, active: [] },
        },
        upcoming: {
          ...base.upcoming,
          query: Option.some({
            ...queryBefore,
            range: {
              end: DateTime.formatIso(
                DateTime.makeUnsafe(now + 30 * 86_400_000)
              ),
              start: DateTime.formatIso(DateTime.makeUnsafe(now)),
            },
          }),
          refreshAt: now + 300_000,
        },
      };

      const empty = update(
        fresh,
        Message.ReceivedUpcoming({
          personId: original.personId,
          request: fresh.upcoming.request,
          result: { ...saved, events: [] },
        })
      ).model;

      yield* TestClock.setTime(now);
      yield* PersistReminderSnooze({
        entry,
        id: original.id,
        personId: original.personId,
      }).effect;

      const restored = update(
        empty,
        yield* RestoreReminderSnoozes({ personId: original.personId }).effect
      ).model;

      const query = Option.getOrThrow(restored.upcoming.query);

      expect(query.range.start).toBe(
        DateTime.formatIso(DateTime.makeUnsafe(now - 86_400_000 - 1))
      );

      const accepted = update(
        restored,
        Message.ReceivedUpcoming({
          personId: original.personId,
          request: restored.upcoming.request,
          result: saved,
        })
      ).model;

      const laterAt = original.candidate.end + 25 * 3_600_000;
      const later = update(accepted, Message.Ticked({ now: laterAt })).model;

      const retained = update(
        later,
        Message.ReceivedUpcoming({
          personId: original.personId,
          request: later.upcoming.request,
          result: { ...saved, events: [] },
        })
      ).model;

      expect(retained.upcoming.reminderEvents).toEqual([
        original.candidate.event,
      ]);

      const fired = update(
        retained,
        Message.Ticked({ now: Math.max(entry.due, laterAt) })
      ).model;

      expect(fired.reminders.context.active).toHaveLength(1);
      expect(fired.reminders.context.active[0]?.card?.snoozedUntil).toBe(
        entry.due
      );

      return yield* Effect.void;
    })
);

it.effect(
  "a reload beyond the accepted 24h history bound silently drops an unresolved old identity",
  () =>
    Effect.gen(function* restoreBeyondBound() {
      const base = reminderCardScene("reminder", "light", 1440).model;
      const [original] = base.reminders.context.active;

      if (original === undefined) {
        return yield* Effect.die(new Error("Missing original reminder"));
      }

      const now = original.candidate.end + 25 * 3_600_000;

      const entry = {
        due: now + 60_000,
        identity: original.candidate.identity,
      };

      const saved = Option.getOrThrow(AsyncData.getData(base.upcoming.data));

      const fresh: AppModel = {
        ...base,
        calendar: { ...base.calendar, now },
        reminders: {
          ...base.reminders,
          context: { ...base.reminders.context, active: [] },
        },
      };

      const empty = update(
        fresh,
        Message.ReceivedUpcoming({
          personId: original.personId,
          request: fresh.upcoming.request,
          result: { ...saved, events: [] },
        })
      ).model;

      yield* TestClock.setTime(now);
      yield* PersistReminderSnooze({
        entry,
        id: original.id,
        personId: original.personId,
      }).effect;

      const restored = update(
        empty,
        yield* RestoreReminderSnoozes({ personId: original.personId }).effect
      ).model;

      const accepted = update(
        restored,
        Message.ReceivedUpcoming({
          personId: original.personId,
          request: restored.upcoming.request,
          result: { ...saved, events: [] },
        })
      ).model;

      const due = update(accepted, Message.Ticked({ now: entry.due })).model;

      const dropped = update(
        due,
        Message.ReceivedUpcoming({
          personId: original.personId,
          request: due.upcoming.request,
          result: { ...saved, events: [] },
        })
      ).model;

      expect(dropped.reminders.context.active).toEqual([]);
      expect(dropped.reminders.context.snoozes).toEqual([]);
      expect(dropped.upcoming.reminderEvents).toEqual([]);

      return yield* Effect.void;
    })
);

it.effect(
  "a stream restoration can initialize a person-scoped stopped model without losing its restored deadline",
  () =>
    Effect.gen(function* restoreStoppedModel() {
      const base = reminderCardScene("reminder", "light", 1440).model;
      const [notification] = base.reminders.context.active;

      if (notification === undefined) {
        return yield* Effect.die(new Error("Missing reminder fixture"));
      }

      const entry = {
        due: base.calendar.now + 300_000,
        identity: notification.candidate.identity,
      };

      const model = { ...base, reminders: initialReminderState() };

      const restored = update(
        model,
        Message.ReminderSnoozesRestored({
          outcome: ReminderSnoozeRestore.cases.Restored.make({
            entries: [entry],
          }),
          personId: notification.personId,
        })
      );

      expect(restored.model.reminders.context.snoozes).toEqual([entry]);
      expect(restored.model.reminders.context.snoozeStorage).toEqual(
        ReminderSnoozeStorage.cases.Ready.make({})
      );
      expect(
        (restored.commands ?? []).filter(
          (command) => command.name === "RestoreReminderSnoozes"
        )
      ).toEqual([]);

      return yield* Effect.void;
    })
);

it.effect.each([false, true])(
  "restore is emitted on the existing person stream before permission observations, storage failure=%s",
  (failed) =>
    Effect.gen(function* streamRestore() {
      const entry = { due: 300_000, identity: "future" };

      yield* TestClock.setTime(60_000);

      if (failed) {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
          throw new Error("Blocked storage");
        });
      } else {
        localStorage.setItem(
          "calendar.reminder-snoozes.v1.person",
          JSON.stringify([entry])
        );
      }

      const port = {
        ...browserNotifications(),
        observe: (personId: string) =>
          Stream.make(
            NotificationEvent.cases.Permission.make({
              permission: "denied",
              personId,
            })
          ),
      };

      const results = yield* reminderNotificationStream("person").pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.provideService(NotificationPort, port)
      );

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual(
        Message.ReminderSnoozesRestored({
          now: 60_000,
          outcome: failed
            ? ReminderSnoozeRestore.cases.Failed.make({})
            : ReminderSnoozeRestore.cases.Restored.make({ entries: [entry] }),
          personId: "person",
        })
      );
      expect(results[1]).toEqual(
        Message.ObservedNotification({
          event: NotificationEvent.cases.Permission.make({
            permission: "denied",
            personId: "person",
          }),
          now: 60_000,
        })
      );
    })
);

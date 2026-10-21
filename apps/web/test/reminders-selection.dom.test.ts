import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import { eventKey } from "../src/client/calendar-state.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { DeliverReminderNotification } from "../src/client/reminders/commands.js";
import { NotificationEvent } from "../src/client/reminders/model.js";
import { NotificationPort } from "../src/client/reminders/port.js";
import { view } from "../src/features/app.js";
import { dayFromIso, visibleDays } from "../src/layout/navigation.js";
import { editorViewFields } from "./editor-fixture.js";
import { fakeNotificationPort } from "./reminders-port-fixture.js";
import {
  savedUpcomingEvent,
  upcomingFixture,
  upcomingNow,
  upcomingPerson,
} from "./upcoming-fixture.js";

const futureEvent = {
  ...savedUpcomingEvent,
  end: { dateTime: "2026-10-29T10:00:00.000Z" },
  eventId: "future-notification",
  iCalUID: "future-notification-uid",
  reminders: {
    overrides: [
      {
        method: "popup" as const,
        minutes:
          (DateTime.toEpochMillis(
            DateTime.makeUnsafe("2026-10-29T09:00:00.000Z")
          ) -
            upcomingNow) /
            60_000 -
          1,
      },
    ],
    useDefault: false,
  },
  start: { dateTime: "2026-10-29T09:00:00.000Z" },
  title: "Future notification",
};

const futureFixture = () => {
  let { model } = update(
    upcomingFixture(),
    Message.ObservedNotification({
      event: NotificationEvent.cases.Permission.make({
        permission: "granted",
        personId: upcomingPerson,
      }),
      now: upcomingNow,
    })
  );

  ({ model } = update(
    model,
    Message.ReceivedUpcoming({
      personId: upcomingPerson,
      request: model.upcoming.request,
      result: { events: [], versions: [] },
    })
  ));
  ({ model } = update(model, Message.Ticked({ now: upcomingNow + 60_000 })));
  ({ model } = update(model, Message.CalendarChanged()));

  return update(
    model,
    Message.ReceivedUpcoming({
      personId: upcomingPerson,
      request: model.upcoming.request,
      result: { events: [futureEvent], versions: [] },
    })
  ).model;
};

it.effect(
  "an outside-week notification navigates then selects without discarding an editor or syncing",
  () =>
    Effect.gen(function* outsideWeek() {
      const initial = futureFixture();
      const [notification] = initial.reminders.context.active;

      if (notification === undefined) {
        return yield* Effect.die(new Error("Missing future notification"));
      }

      const editor = EditorView.cases.Editing.make(editorViewFields);

      const model = {
        ...initial,
        editing: { ...initial.editing, view: editor },
      };

      const selected = update(
        model,
        Message.ObservedNotification({
          event: NotificationEvent.cases.Clicked.make({ notification }),
          now: model.calendar.now,
        })
      );

      expect(visibleDays(selected.model.calendar.navigation)).toContain(
        dayFromIso("2026-10-29")
      );
      expect(selected.model.calendar.selected).toEqual([
        notification.candidate.key,
      ]);
      expect(selected.model.editing.view).toBe(editor);
      expect(
        selected.commands?.some((command) => command.name === "ReadEvents")
      ).toBe(true);
      expect(
        selected.commands?.some(
          (command) =>
            command.name === "RefreshEvents" ||
            command.name === "DispatchEditing"
        )
      ).toBe(false);

      const loaded = update(
        selected.model,
        Message.ReceivedEvents({
          accountId: futureEvent.accountId,
          request: selected.model.calendar.rangeRequest,
          result: { events: [futureEvent], versions: [] },
        })
      ).model;

      const rendered = yield* renderToString(
        { init: () => ({ model: loaded }), view },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      expect(document.querySelector(".detail-panel")?.textContent).toContain(
        "Future notification"
      );

      return yield* Effect.void;
    })
);

it.effect(
  "notification selection adapts the canonical reminder identity to an unmerged view",
  () =>
    Effect.sync(() => {
      const initial = futureFixture();
      const [notification] = initial.reminders.context.active;

      if (notification === undefined) {
        throw new Error("Missing future notification");
      }

      const model = {
        ...initial,
        calendar: { ...initial.calendar, mergeDuplicates: false },
      };

      const result = update(
        model,
        Message.ObservedNotification({
          event: NotificationEvent.cases.Clicked.make({ notification }),
          now: model.calendar.now,
        })
      );

      expect(result.model.calendar.selected).toEqual([eventKey(futureEvent)]);
    })
);

it.effect(
  "old-person notification callbacks cannot select after sign-out",
  () =>
    Effect.sync(() => {
      const initial = futureFixture();
      const [notification] = initial.reminders.context.active;

      if (notification === undefined) {
        throw new Error("Missing future notification");
      }

      const signedOut = update(
        initial,
        Message.ReceivedSession({ snapshot: null })
      );

      expect(signedOut.model.reminders.value).toBe("stopped");

      const stale = update(
        signedOut.model,
        Message.ObservedNotification({
          event: NotificationEvent.cases.Clicked.make({ notification }),
          now: initial.calendar.now,
        })
      );

      expect(stale.model).toBe(signedOut.model);
      expect(stale.model.calendar.selected).toEqual([]);
    })
);

it.effect(
  "delivery refusal stays a visible failure rather than a delivered notification",
  () =>
    Effect.gen(function* notificationRefusal() {
      const initial = futureFixture();
      const [notification] = initial.reminders.context.active;

      if (notification === undefined) {
        return yield* Effect.die(new Error("Missing future notification"));
      }

      const fake = yield* fakeNotificationPort("granted");
      yield* fake.refuseDelivery("delivery");

      const reply = yield* DeliverReminderNotification({
        notification,
      }).effect.pipe(Effect.provideService(NotificationPort, fake.port));

      const result = update(initial, reply);
      expect(result.model.reminders.context.active).toHaveLength(0);
      expect(Option.isSome(result.model.reminders.failure)).toBe(true);
      expect(fake.shown).toHaveLength(0);
      expect(fake.attempts).toHaveLength(1);

      return yield* Effect.void;
    })
);

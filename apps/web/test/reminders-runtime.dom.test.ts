import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Predicate, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import { AsyncData } from "foldkit";
import { renderToString } from "foldkit/experimental/server";
import type { HtmlBuilder } from "foldkit/html";
import { Scene } from "foldkit/test";

import { Message, update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { EditingRuntime } from "../src/client/editing/runtime.js";
import { RequestReminderPermission } from "../src/client/reminders/commands.js";
import { NotificationEvent } from "../src/client/reminders/model.js";
import { NotificationPort } from "../src/client/reminders/port.js";
import type { NotificationPortService } from "../src/client/reminders/port.js";
import { reminderNotificationStream } from "../src/client/reminders/subscription.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import { view } from "../src/features/app.js";
import { remindersPermission } from "../src/features/reminders-permission.js";
import { SettingsRoute } from "../src/layout/route.js";
import { fakeNotificationPort } from "./reminders-port-fixture.js";
import {
  savedUpcomingEvent,
  upcomingFixture,
  upcomingNow,
  upcomingPerson,
} from "./upcoming-fixture.js";

type Result = ReturnType<typeof update>;

const noSearch = CalendarSearchClient.of({
  prefetch: () => Effect.die(new Error("Unexpected search prefetch")),
  search: () => Effect.die(new Error("Unexpected search request")),
});

const noEditing = EditingRuntime.of({
  connect: () => Effect.die(new Error("Unexpected editing connection")),
  dispatch: () => Effect.die(new Error("Unexpected editing write")),
});

const notificationEvent: CalendarEventValue = {
  ...savedUpcomingEvent,
  reminders: {
    overrides: [{ method: "popup", minutes: 1259 }],
    useDefault: false,
  },
};

const permissionView = (model: AppModel, h: HtmlBuilder<AppMessage>) => ({
  body: remindersPermission(model, h),
  title: "Browser notifications",
});

const observer = Effect.fn("notificationTestObserver")(function* observer(
  port: NotificationPortService
) {
  const messages = yield* Queue.unbounded<AppMessage>();
  yield* reminderNotificationStream(upcomingPerson).pipe(
    Stream.runForEach((message) => Queue.offer(messages, message)),
    Effect.provideService(NotificationPort, port),
    Effect.forkScoped
  );

  return { next: Queue.take(messages) };
});

const accept = (model: AppModel, events: readonly CalendarEventValue[]) =>
  update(
    model,
    Message.ReceivedUpcoming({
      personId: upcomingPerson,
      request: model.upcoming.request,
      result: { events, versions: [] },
    })
  );

const executeNotifications = Effect.fn("executeTestNotifications")(
  function* executeNotifications(
    result: Result,
    port: NotificationPortService
  ) {
    let { model } = result;

    for (const command of result.commands ?? []) {
      if (
        [
          "RequestReminderPermission",
          "DeliverReminderNotification",
          "CloseReminderNotifications",
        ].includes(command.name)
      ) {
        const message = yield* command.effect.pipe(
          Effect.provideService(NotificationPort, port),
          Effect.provideService(EditingRuntime, noEditing),
          Effect.provideService(CalendarSearchClient, noSearch)
        );

        ({ model } = update(model, message));
      }
    }

    return model;
  }
);

it.effect.each([
  { enable: true, permission: "default", text: "not yet enabled" },
  { enable: false, permission: "granted", text: "allowed" },
  { enable: false, permission: "denied", text: "site settings" },
  { enable: false, permission: "unsupported", text: "does not support" },
] as const)(
  "permission row honestly renders $permission without requesting it",
  ({ permission, text, enable }) =>
    Effect.gen(function* permissionState() {
      const { model } = update(
        upcomingFixture(),
        Message.ObservedNotification({
          event: NotificationEvent.cases.Permission.make({
            permission,
            personId: upcomingPerson,
          }),
          now: upcomingNow,
        })
      );

      const rendered = yield* renderToString(
        { init: () => ({ model }), view: permissionView },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      expect(document.body.textContent).toContain(text);
      expect(document.querySelector("#enable-reminders") !== null).toBe(enable);
    })
);

it.effect(
  "only an explicit permission click calls the port, and a pending click cannot prompt twice",
  () =>
    Effect.gen(function* explicitPermission() {
      yield* TestClock.setTime(upcomingNow);
      const fake = yield* fakeNotificationPort();
      const { next } = yield* observer(fake.port);
      const initial = update(upcomingFixture(), yield* next).model;
      expect(fake.requests).toHaveLength(0);
      yield* fake.setPermission("granted");
      const clicked = update(initial, Message.ClickedEnableReminders());
      expect(clicked.model.reminders.value).toBe("requesting");
      expect(
        update(clicked.model, Message.ClickedEnableReminders()).commands ?? []
      ).toHaveLength(0);

      const command = clicked.commands?.find(
        (item) => item.name === "RequestReminderPermission"
      );

      if (command === undefined) {
        return yield* Effect.die(
          new Error("Permission button omitted its command")
        );
      }

      const completion = yield* command.effect.pipe(
        Effect.provideService(NotificationPort, fake.port),
        Effect.provideService(EditingRuntime, noEditing),
        Effect.provideService(CalendarSearchClient, noSearch)
      );

      if (!Predicate.isTagged(completion, "ReminderPermissionCompleted")) {
        return yield* Effect.die(
          new Error("Permission command returned another message")
        );
      }

      const complete = update(clicked.model, completion).model;
      expect(complete.reminders.context.permission).toBe("granted");
      expect(fake.requests).toHaveLength(1);
      Scene.scene(
        { update, view: permissionView },
        Scene.given(initial),
        Scene.click(Scene.role("button", { name: "Turn on reminders" })),
        Scene.Command.resolve(RequestReminderPermission, completion),
        Scene.expect(Scene.selector("#enable-reminders")).toBeAbsent()
      );

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect(
  "a single accepted upcoming read feeds the scheduler immediately and fake notification clicks select its event",
  () =>
    Effect.gen(function* notificationRecipient() {
      yield* TestClock.setTime(upcomingNow);
      const fake = yield* fakeNotificationPort("granted");
      const { next } = yield* observer(fake.port);
      let { model } = update(upcomingFixture(), yield* next);
      model = { ...model, settings: { ...model.settings, timeFormat: "24" } };
      ({ model } = accept(model, []));
      yield* TestClock.adjust(60_000);
      ({ model } = update(
        model,
        Message.Ticked({ now: upcomingNow + 60_000 })
      ));
      ({ model } = update(model, Message.CalendarChanged()));
      const accepted = accept(model, [notificationEvent]);
      expect(
        Option.getOrUndefined(AsyncData.getData(accepted.model.upcoming.data))
          ?.events
      ).toEqual([notificationEvent]);
      expect(accepted.model.reminders.context.accepted).toEqual(
        accepted.model.upcoming.accepted.pipe(
          Option.map((receipt) => receipt.request)
        )
      );
      expect(accepted.commands?.map((command) => command.name)).toContain(
        "DeliverReminderNotification"
      );
      model = yield* executeNotifications(accepted, fake.port);
      expect(fake.shown).toHaveLength(1);
      const [shown] = fake.shown;

      if (shown === undefined) {
        return yield* Effect.die(
          new Error("Fake notification was not created")
        );
      }

      expect(shown.candidate.body).toContain("09:00");
      expect(shown.candidate.body).not.toMatch(/am|pm/u);
      ({ model } = update(
        model,
        Message.ReceivedEvents({
          accountId: notificationEvent.accountId,
          request: model.calendar.rangeRequest,
          result: { events: [notificationEvent], versions: [] },
        })
      ));
      model = {
        ...model,
        route: SettingsRoute.make({ page: "notifications" }),
      };
      yield* fake.click(shown);
      const selected = update(model, yield* next);
      expect(selected.model.calendar.selected).toEqual(
        Option.some(shown.candidate.key)
      );
      expect(selected.model.route._tag).toBe("Calendar");
      expect(fake.focused).toEqual([upcomingPerson]);

      const rendered = yield* renderToString(
        { init: () => ({ model: selected.model }), view },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      expect(document.querySelector(".detail-panel")?.textContent).toContain(
        "Saved meeting"
      );

      const ended = update(
        selected.model,
        Message.Ticked({ now: upcomingNow + 24 * 60 * 60_000 })
      );

      model = yield* executeNotifications(ended, fake.port);
      expect(fake.closed).toContainEqual({
        id: shown.id,
        personId: upcomingPerson,
      });
      expect(model.reminders.context.active).toHaveLength(0);
      expect(fake.requests).toHaveLength(0);

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect(
  "Notifications has a native route link and no duplicate preference control",
  () =>
    Effect.gen(function* notificationNavigation() {
      const model = {
        ...upcomingFixture(),
        route: SettingsRoute.make({ page: "notifications" }),
      };

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      expect(
        document.querySelector("a[href='/settings/notifications']")?.textContent
      ).toBe("Notifications");
      expect(document.querySelectorAll("#settings-event-invites")).toHaveLength(
        1
      );
      expect(document.body.textContent).not.toContain("not available yet");
    })
);

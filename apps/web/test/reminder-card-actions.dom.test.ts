import { MeetingJoinOutcome } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Match, Option, Schema } from "effect";
import { AsyncData } from "foldkit";
import type { HtmlBuilder } from "foldkit/html";
import { UrlRequest } from "foldkit/navigation";
import { Scene } from "foldkit/test";

import type { AppModel, AppMessage } from "../src/client/app.js";
import { Message, update } from "../src/client/app.js";
import { JoinMeeting } from "../src/client/meetings/commands.js";
import { JoinSelection } from "../src/client/meetings/model.js";
import { MeetingPort } from "../src/client/meetings/port.js";
import { CloseReminderNotifications } from "../src/client/reminders/commands.js";
import {
  PermissionOutcome,
  NotificationEvent,
  NotificationFailure,
  ReminderCardAction,
} from "../src/client/reminders/model.js";
import { FollowRouteRequest } from "../src/client/routing.js";
import { reminderCards } from "../src/features/reminder-cards.js";
import { reminderCardScene } from "./reminder-card-fixture.js";

it.prop(
  "desktop and unknown modes retain the existing undecorated notification delivery and no card",
  [Schema.Literals(["available", "unknown"]), Schema.Boolean],
  ([availability, granted]) => {
    const result = reminderCardScene(
      "prompt",
      "light",
      1440,
      granted ? "granted" : "denied",
      availability
    );

    expect(result.model.reminders.context.active).toHaveLength(granted ? 1 : 0);
    expect(
      (result.commands ?? []).filter(
        (command) => command.name === "DeliverReminderNotification"
      )
    ).toHaveLength(granted ? 1 : 0);

    for (const notification of result.model.reminders.context.active) {
      expect(notification.card).toBeUndefined();
      expect(notification.title).toBe("Weekly project review");
    }
  }
);

it.prop(
  "an explicit expiry receipt retires the matching card before the next model tick, but other failures and stale receipts preserve it",
  [
    Schema.Struct({
      other: Schema.Literals(["none", "person", "id"]),
      reason: Schema.Literals([
        "expired",
        "delivery",
        "permission",
        "inactive",
        "unsupported",
      ]),
    }),
    ReminderCardAction,
  ],
  ([{ reason, other }, action]) => {
    const { model } = reminderCardScene("prompt", "light", 1440);
    const [notification] = model.reminders.context.active;
    expect(notification).toBeDefined();

    if (notification === undefined) {
      return;
    }

    const receipt = Message.ReminderDeliveryCompleted({
      failure: Option.some(new NotificationFailure({ reason })),
      id: other === "id" ? `${notification.id}:stale` : notification.id,
      personId:
        other === "person"
          ? `${notification.personId}:stale`
          : notification.personId,
    });

    const result = update(model, receipt);
    const retired = reason === "expired" && other === "none";
    expect(result.model.calendar.now).toBe(model.calendar.now);
    expect(result.model.reminders.context.active).toHaveLength(retired ? 0 : 1);
    expect(result.model.reminders.context.dismissedPrompts ?? []).toEqual([]);
    expect(
      (result.commands ?? []).filter(
        (command) => command.name === "CloseReminderNotifications"
      )
    ).toHaveLength(retired ? 1 : 0);

    if (retired) {
      const repeated = update(result.model, receipt);
      expect(repeated.commands ?? []).toEqual([]);

      const late = update(
        result.model,
        Message.ReminderCardAction({
          action,
          id: notification.id,
          personId: notification.personId,
        })
      );

      expect(late.commands ?? []).toEqual([]);
      expect(late.model.calendar.selected).toEqual(model.calendar.selected);
    }
  }
);

const cardsView = (model: AppModel, h: HtmlBuilder<AppMessage>) => ({
  body: h.div([], reminderCards(model, h)),
  title: "Reminder actions",
});

it.effect(
  "actual card buttons dispatch Join and the existing mailto workflow, and dismiss removes the card",
  () =>
    Effect.sync(() => {
      const { model } = reminderCardScene("prompt", "light", 1440);
      Scene.scene(
        { update, view: cardsView },
        Scene.given(model),
        Scene.click(Scene.role("button", { name: "Join" })),
        Scene.Command.expectHas(JoinMeeting),
        Scene.Command.resolve(
          JoinMeeting,
          Message.FinishedJoinMeeting({
            outcome: MeetingJoinOutcome.cases.NoMeeting.make({
              reason: "noUpcoming",
            }),
            personId: Option.getOrThrow(model.person),
          })
        ),
        Scene.Command.resolve(
          CloseReminderNotifications,
          Message.ReminderEffectCompleted()
        ),
        Scene.expect(Scene.selector(".reminder-card")).toBeAbsent()
      );
      Scene.scene(
        { update, view: cardsView },
        Scene.given(model),
        Scene.click(Scene.role("button", { name: "Email participants…" })),
        Scene.Command.expectHas(FollowRouteRequest),
        Scene.Command.resolve(FollowRouteRequest, Message.Navigated()),
        Scene.Command.resolve(
          CloseReminderNotifications,
          Message.ReminderEffectCompleted()
        ),
        Scene.expect(Scene.selector(".reminder-card")).toBeAbsent()
      );
      Scene.scene(
        { update, view: cardsView },
        Scene.given(model),
        Scene.click(Scene.role("button", { name: "Dismiss" })),
        Scene.Command.resolve(
          CloseReminderNotifications,
          Message.ReminderEffectCompleted()
        ),
        Scene.expect(Scene.selector(".reminder-card")).toBeAbsent()
      );
    })
);

it.prop(
  "each card action resolves both presentations once and late repeats do nothing",
  [ReminderCardAction],
  ([action]) => {
    const { model } = reminderCardScene("prompt", "light", 1440);
    const [notification] = model.reminders.context.active;
    expect(notification?.card?.kind).toBe("upcoming");

    if (notification === undefined) {
      return;
    }

    const result = update(
      model,
      Message.ReminderCardAction({
        action,
        id: notification.id,
        personId: notification.personId,
      })
    );

    expect(result.model.reminders.context.active).toEqual([]);
    expect(
      result.commands?.filter(
        (command) => command.name === "CloseReminderNotifications"
      )
    ).toHaveLength(1);
    expect(result.model.reminders.context.dismissedPrompts).toHaveLength(1);

    if (action === "join") {
      expect(
        result.commands?.filter((command) => command.name === "JoinMeeting")
      ).toHaveLength(1);
    } else if (action === "email") {
      const args = result.commands?.find(
        (command) => command.name === "FollowRouteRequest"
      )?.args;

      expect(args).toEqual({
        request: UrlRequest.External({
          href: "mailto:guest@example.test?subject=Weekly%20project%20review",
        }),
      });
      expect(
        result.commands?.filter(
          (command) => command.name === "FollowRouteRequest"
        )
      ).toHaveLength(1);
    } else if (action === "show") {
      expect(result.model.calendar.selected).toHaveLength(1);
    }

    const repeated = update(
      result.model,
      Message.ReminderCardAction({
        action,
        id: notification.id,
        personId: notification.personId,
      })
    );

    expect(repeated.model.reminders.context.active).toEqual([]);
    expect(repeated.commands ?? []).toEqual([]);
  }
);

it.effect(
  "the card Join command reaches the existing recipient with the exact current saved URL and event",
  () =>
    Effect.gen(function* cardJoinRecipient() {
      const { model } = reminderCardScene("prompt", "light", 1440);
      const [notification] = model.reminders.context.active;

      if (notification === undefined) {
        return yield* Effect.die(new Error("Missing card fixture"));
      }

      const result = update(
        model,
        Message.ReminderCardAction({
          action: "join",
          id: notification.id,
          personId: notification.personId,
        })
      );

      const command = result.commands?.find(
        (entry) => entry.name === "JoinMeeting"
      );

      const args = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ personId: Schema.String, selection: JoinSelection })
      )(command?.args);

      const opened: {
        readonly conferenceUrl: string;
        readonly key: { readonly eventId: string };
      }[] = [];

      yield* JoinMeeting(args).effect.pipe(
        Effect.provideService(MeetingPort, {
          open: (request) =>
            Effect.sync(() => {
              opened.push(request);

              return MeetingJoinOutcome.cases.Requested.make({
                key: request.key,
              });
            }),
        })
      );
      expect(args.personId).toBe(notification.personId);
      expect(opened).toEqual([
        {
          conferenceUrl: "https://meet.google.com/aaa-bbbb-ccc",
          key: {
            accountId: notification.candidate.event.accountId,
            calendarId: notification.candidate.event.calendarId,
            eventId: notification.candidate.event.eventId,
          },
        },
      ]);

      return yield* Effect.void;
    })
);

it.prop(
  "browser-only cards are delivered without denied or unsupported OS permission",
  [Schema.Literals(["denied", "unsupported", "default"])],
  ([permission]) => {
    const result = reminderCardScene("prompt", "light", 1440, permission);
    expect(result.model.reminders.context.active).toHaveLength(1);
    expect(
      (result.commands ?? []).some(
        (command) =>
          command.name === "RequestReminderPermission" ||
          command.name === "DeliverReminderNotification"
      )
    ).toBe(false);
  }
);

it.prop(
  "retimed or removed occurrences cannot be joined, emailed or selected from stale cards",
  [ReminderCardAction, Schema.Boolean],
  ([action, removed]) => {
    const { model } = reminderCardScene("prompt", "light", 1440);
    const [notification] = model.reminders.context.active;
    expect(notification).toBeDefined();

    if (notification === undefined) {
      return;
    }

    const saved = Option.getOrThrow(AsyncData.getData(model.upcoming.data));

    const stale = {
      ...model,
      upcoming: {
        ...model.upcoming,
        data: AsyncData.Success({
          data: {
            ...saved,
            events: removed
              ? []
              : saved.events.map((event) => ({
                  ...event,
                  start: { dateTime: "2026-10-20T13:02:00.000Z" },
                })),
          },
        }),
      },
    };

    const actionResult = update(
      stale,
      Message.ReminderCardAction({
        action,
        id: notification.id,
        personId: notification.personId,
      })
    );

    expect(actionResult.commands ?? []).toEqual([]);
    expect(actionResult.model.calendar.selected).toEqual(
      stale.calendar.selected
    );

    const ticked = update(
      stale,
      Message.Ticked({ now: stale.calendar.now + 1000 })
    );

    expect(ticked.model.reminders.context.active).toEqual([]);
  }
);

it.prop(
  "prompt cards expire only after fifteen whole elapsed minutes",
  [Schema.Boolean],
  ([afterBoundary]) => {
    const { model } = reminderCardScene("prompt", "light", 1440);
    const [notification] = model.reminders.context.active;
    expect(notification).toBeDefined();

    if (notification === undefined) {
      return;
    }

    const ticked = update(
      model,
      Message.Ticked({
        now:
          notification.candidate.start +
          (afterBoundary ? 16 * 60_000 : 15 * 60_000 + 59_999),
      })
    );

    expect(ticked.model.reminders.context.active).toHaveLength(
      afterBoundary ? 0 : 1
    );
  }
);

it.prop(
  "permission denial and unsupported mode keep the usable card and never request permission or replay a popup",
  [Schema.Literals(["denied", "unsupported"])],
  ([permission]) => {
    const { model } = reminderCardScene("prompt", "light", 1440);

    const changed = update(
      model,
      Message.ReminderPermissionCompleted({
        now: model.calendar.now,
        outcome: PermissionOutcome.cases.Observed.make({ permission }),
        personId: Option.getOrThrow(model.person),
      })
    );

    expect(changed.model.reminders.context.active).toHaveLength(1);
    expect(
      changed.commands?.some(
        (command) =>
          command.name === "RequestReminderPermission" ||
          command.name === "DeliverReminderNotification"
      )
    ).toBe(false);

    const ticked = update(
      changed.model,
      Message.Ticked({ now: model.calendar.now + 1000 })
    );

    expect(ticked.model.reminders.context.active).toHaveLength(1);
    expect(
      (ticked.commands ?? []).some(
        (command) =>
          command.name === "RequestReminderPermission" ||
          command.name === "DeliverReminderNotification"
      )
    ).toBe(false);
  }
);

it.prop(
  "generated action, native-error and permission histories agree with an independent single-card oracle",
  [
    Schema.Array(
      Schema.Literals([
        "show",
        "join",
        "email",
        "dismiss",
        "closed",
        "failed",
        "denied",
        "tick",
      ])
    ),
  ],
  ([events]) => {
    let { model } = reminderCardScene("prompt", "light", 1440);
    const [notification] = model.reminders.context.active;
    expect(notification).toBeDefined();

    if (notification === undefined) {
      return;
    }

    let alive = true;

    for (const event of events) {
      const { now } = model.calendar;

      const message = Match.value(event).pipe(
        Match.when("closed", () =>
          Message.ObservedNotification({
            event: NotificationEvent.cases.Closed.make({
              id: notification.id,
              personId: notification.personId,
            }),
            now,
          })
        ),
        Match.when("failed", () =>
          Message.ObservedNotification({
            event: NotificationEvent.cases.Failed.make({
              id: notification.id,
              personId: notification.personId,
            }),
            now,
          })
        ),
        Match.when("denied", () =>
          Message.ObservedNotification({
            event: NotificationEvent.cases.Permission.make({
              permission: "denied",
              personId: notification.personId,
            }),
            now,
          })
        ),
        Match.when("tick", () => Message.Ticked({ now: now + 1000 })),
        Match.orElse((action) =>
          Message.ReminderCardAction({
            action,
            id: notification.id,
            personId: notification.personId,
          })
        )
      );

      const result = update(model, message);

      if (["show", "join", "email", "dismiss"].includes(event)) {
        alive = false;
      }

      expect(
        result.model.reminders.context.active.map((item) => item.id)
      ).toEqual(alive ? [notification.id] : []);
      expect(
        (result.commands ?? []).some(
          (command) =>
            command.name === "DeliverReminderNotification" ||
            command.name === "RequestReminderPermission"
        )
      ).toBe(false);
      ({ model } = result);
    }
  }
);

it.prop(
  "native close only retires the OS presentation, while wrong-person actions cannot consume the card",
  [Schema.String],
  ([suffix]) => {
    const { model } = reminderCardScene("prompt", "dark", 900);
    const [notification] = model.reminders.context.active;

    if (notification === undefined) {
      expect(model.reminders.context.active).toHaveLength(1);

      return;
    }

    const otherPerson = `${notification.personId}:other:${suffix}`;

    const ignored = update(
      model,
      Message.ReminderCardAction({
        action: "dismiss",
        id: notification.id,
        personId: otherPerson,
      })
    );

    expect(ignored.model.reminders.context.active).toEqual(
      model.reminders.context.active
    );

    const closed = update(
      model,
      Message.ObservedNotification({
        event: NotificationEvent.cases.Closed.make({
          id: notification.id,
          personId: otherPerson,
        }),
        now: model.calendar.now,
      })
    );

    expect(closed.model.reminders.context.active).toEqual(
      model.reminders.context.active
    );

    const resolved = update(
      model,
      Message.ObservedNotification({
        event: NotificationEvent.cases.Closed.make({
          id: notification.id,
          personId: notification.personId,
        }),
        now: model.calendar.now,
      })
    );

    expect(resolved.model.reminders.context.active).toEqual(
      model.reminders.context.active
    );
    expect(resolved.commands ?? []).toEqual([]);
    expect(resolved.model.person).toEqual(Option.some(notification.personId));
  }
);

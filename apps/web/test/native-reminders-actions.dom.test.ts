import type { RsvpInput } from "@calendar/calendar/contracts";
import {
  NativeNotificationNotice,
  defaultDesktopPreferences,
} from "@calendar/core/desktop-bridge";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Queue, Schema, Stream } from "effect";

import { Message, update } from "../src/client/app.js";
import { agendaSnapshot } from "../src/client/desktop/snapshot.js";
import { desktopDependencies } from "../src/client/desktop/subscription.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DispatchEditing } from "../src/client/editing/commands.js";
import { DeletionWriter } from "../src/client/editing/delete-actor.js";
import {
  EditingCommand,
  EditingRuntime,
} from "../src/client/editing/runtime.js";
import { NotificationEvent } from "../src/client/reminders/model.js";
import {
  nativeInvite,
  nativeReminderModel,
} from "./native-reminders-fixture.js";
import { upcomingPerson } from "./upcoming-fixture.js";

it.effect(
  "native authority contains an eligible invite outside the tray horizon without changing tray membership",
  () =>
    Effect.sync(() => {
      const { model, ref } = nativeReminderModel();
      expect(agendaSnapshot(model, defaultDesktopPreferences()).events).toEqual(
        []
      );
      const { snapshot } = desktopDependencies(model);
      expect(snapshot.events).toEqual([]);
      expect(snapshot.notificationAgenda?.events).toMatchObject([
        { key: ref.key, participantEmails: ["guest@example.test"], rsvp: true },
      ]);
      expect(snapshot.notificationAgenda?.deliveries).toMatchObject([
        { id: ref.id, kind: "invite" },
      ]);
      expect(JSON.stringify(snapshot.notificationAgenda)).not.toContain(
        "Saved server value"
      );
    })
);

it.effect.each(["accepted", "declined", "tentative"] as const)(
  "native %s reaches the existing occurrence writer with no note and send updates none",
  (response) =>
    Effect.gen(function* nativeRsvpWriter() {
      const { model, ref } = nativeReminderModel();

      const notice = NativeNotificationNotice.cases.ActionSelected.make({
        action: response,
        ref,
      });

      const result = update(
        model,
        Message.ObservedNotification({
          event: NotificationEvent.cases.Native.make({ notice }),
          now: model.calendar.now,
        })
      );

      const commands = (result.commands ?? []).filter(
        (command) => command.name === "DispatchEditing"
      );

      expect(commands).toHaveLength(1);

      const args = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ command: EditingCommand, personId: Schema.String })
      )(commands[0]?.args);

      expect(args).toEqual({
        command: EditingCommand.cases.Rsvp.make({
          event: nativeInvite,
          notePolicy: "omit",
          response,
        }),
        personId: upcomingPerson,
      });
      const calls = yield* Queue.unbounded<typeof RsvpInput.Type>();
      const unexpected = Effect.die("Native notification used another writer");

      const client = CalendarEditingClient.of({
        createEvent: () => unexpected,
        deleteEvent: () => unexpected,
        getEvent: () => unexpected,
        moveAndRetimeSeries: () => unexpected,
        moveEvent: () => unexpected,
        moveSupport: "notAvailable",
        rsvp: (request) =>
          Queue.offer(calls, request).pipe(Effect.as(nativeInvite)),
        updateEvent: () => unexpected,
      });

      const services = Layer.merge(
        Layer.succeed(CalendarEditingClient, client),
        Layer.succeed(
          DeletionWriter,
          DeletionWriter.of({ commit: () => unexpected })
        )
      );

      const context = yield* Layer.build(
        EditingRuntime.layer.pipe(Layer.provide(services))
      );

      const runtime = yield* Effect.service(EditingRuntime).pipe(
        Effect.provide(context)
      );

      const notices = yield* runtime.connect(upcomingPerson);
      yield* notices.pipe(Stream.runDrain, Effect.forkScoped);
      yield* DispatchEditing(args).effect.pipe(
        Effect.provideService(EditingRuntime, runtime)
      );
      expect(yield* Queue.take(calls)).toEqual({
        accountId: nativeInvite.accountId,
        calendarId: nativeInvite.calendarId,
        eventId: nativeInvite.eventId,
        response,
        sendUpdates: "none",
      });
      expect(yield* Queue.poll(calls)).toEqual(Option.none());
      expect(result.model.calendar.selected).toEqual(model.calendar.selected);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
);

it.effect.each([
  "lease",
  "person",
  "start",
  "key",
  "hidden",
  "declined",
] as const)("native saved-event recipient refuses %s targets", (change) =>
  Effect.sync(() => {
    const { model, ref } = nativeReminderModel();

    const target = {
      ...ref,
      key: change === "key" ? { ...ref.key, eventId: "series" } : ref.key,
      lease: change === "lease" ? "old-lease" : ref.lease,
      personId: change === "person" ? "old-person" : ref.personId,
      start: change === "start" ? ref.start + 1 : ref.start,
    };

    const current =
      change === "hidden"
        ? {
            ...model,
            calendar: {
              ...model.calendar,
              hidden: [JSON.stringify([ref.key.accountId, ref.key.calendarId])],
            },
          }
        : model;

    const event =
      change === "declined"
        ? {
            ...nativeInvite,
            attendees: [
              {
                email: "person@example.test",
                responseStatus: "declined" as const,
                self: true,
              },
            ],
          }
        : undefined;

    const loaded =
      event === undefined
        ? current
        : update(
            current,
            Message.ReceivedUpcoming({
              personId: upcomingPerson,
              request: current.upcoming.request,
              result: { events: [event], versions: [] },
            })
          ).model;

    const result = update(
      loaded,
      Message.ObservedNotification({
        event: NotificationEvent.cases.Native.make({
          notice: NativeNotificationNotice.cases.ActionSelected.make({
            action: "accepted",
            ref: target,
          }),
        }),
        now: loaded.calendar.now,
      })
    );

    expect(
      (result.commands ?? []).filter(
        (command) => command.name === "DispatchEditing"
      )
    ).toEqual([]);
  })
);

it.effect(
  "native body click selects the exact saved event outside the visible week without creating an RSVP",
  () =>
    Effect.sync(() => {
      const { model, ref } = nativeReminderModel();

      const result = update(
        model,
        Message.ObservedNotification({
          event: NotificationEvent.cases.Native.make({
            notice: NativeNotificationNotice.cases.Clicked.make({ ref }),
          }),
          now: model.calendar.now,
        })
      );

      expect(result.model.calendar.selected).toContain(
        model.reminders.context.active[0]?.candidate.key
      );
      expect(
        (result.commands ?? []).some(
          (command) => command.name === "DispatchEditing"
        )
      ).toBe(false);
      expect(result.model.reminders.context.active).toEqual([]);
    })
);

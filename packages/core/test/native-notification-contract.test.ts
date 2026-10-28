import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";

import {
  AgendaSnapshot,
  NativeNotificationNotice,
  NativeNotificationRef,
  NativeNotificationRequest,
  NativeReminderSnoozeChoice,
  NativeReminderSnoozeOutcome,
  nativeNotificationWire,
} from "../src/desktop-bridge.js";

it.effect.prop(
  "versioned native notification operations and observations round trip their complete event identity",
  { ref: Arbitrary.schema(NativeNotificationRef) },
  ({ ref }) =>
    Effect.gen(function* roundTrip() {
      const request = NativeNotificationRequest.cases.Show.make({
        ref,
        version: 1,
      });

      expect(
        yield* Schema.decodeEffect(nativeNotificationWire.request)(
          yield* Schema.encodeEffect(nativeNotificationWire.request)(request)
        )
      ).toEqual(request);

      const notice = {
        notice: NativeNotificationNotice.cases.Clicked.make({ ref }),
        version: 1 as const,
      };

      expect(
        yield* Schema.decodeEffect(nativeNotificationWire.notice)(
          yield* Schema.encodeEffect(nativeNotificationWire.notice)(notice)
        )
      ).toEqual(notice);
      expect(
        Schema.decodeUnknownOption(NativeNotificationRequest, {
          onExcessProperty: "error",
        })({ ...request, href: "https://forged.example.test" })._tag
      ).toBe("None");
      expect(
        Schema.decodeOption(nativeNotificationWire.request)(
          JSON.stringify({ ...request, version: 2 })
        )._tag
      ).toBe("None");
    })
);

it.effect.prop(
  "native snooze notices and matching presentation results preserve choice and authority without changing the legacy wire",
  {
    choice: Arbitrary.schema(NativeReminderSnoozeChoice),
    outcome: Arbitrary.schema(NativeReminderSnoozeOutcome),
    ref: Arbitrary.schema(NativeNotificationRef),
  },
  ({ ref, choice, outcome }) =>
    Effect.gen(function* snoozeWire() {
      const ready = {
        notice: NativeNotificationNotice.cases.Ready.make({ ref }),
        version: 1 as const,
      };

      expect(
        yield* Schema.decodeEffect(nativeNotificationWire.notice)(
          yield* Schema.encodeEffect(nativeNotificationWire.notice)(ready)
        )
      ).toEqual(ready);

      const notice = {
        notice: NativeNotificationNotice.cases.SnoozeSelected.make({
          choice,
          ref,
        }),
        version: 1 as const,
      };

      expect(
        yield* Schema.decodeEffect(nativeNotificationWire.notice)(
          yield* Schema.encodeEffect(nativeNotificationWire.notice)(notice)
        )
      ).toEqual(notice);

      const request = NativeNotificationRequest.cases.SnoozeResult.make({
        outcome,
        ref,
        version: 1,
      });

      expect(
        yield* Schema.decodeEffect(nativeNotificationWire.request)(
          yield* Schema.encodeEffect(nativeNotificationWire.request)(request)
        )
      ).toEqual(request);
      expect(
        Schema.decodeUnknownOption(NativeNotificationNotice, {
          onExcessProperty: "error",
        })({ ...notice.notice, href: "https://wrong.example.test" })._tag
      ).toBe("None");
    })
);

it.effect.each([0, -1, 2, 1.5, "1", "tomorrow", "", null])(
  "native snooze rejects unsupported choice %s instead of coercing a string duration",
  (choice) =>
    Effect.sync(() => {
      expect(
        Schema.decodeUnknownOption(NativeReminderSnoozeChoice)(choice)._tag
      ).toBe("None");
    })
);

it.effect(
  "legacy agenda rows survive missing or unsupported native extensions without admitting native operations",
  () =>
    Effect.gen(function* legacy() {
      expect(
        yield* Schema.decodeEffect(AgendaSnapshot)({ events: [] })
      ).toEqual({ events: [] });
      expect(
        yield* Schema.decodeUnknownEffect(AgendaSnapshot)({
          events: [],
          notificationAgenda: { version: 2 },
        })
      ).toEqual({ events: [], notificationAgenda: undefined });
      expect(
        Schema.decodeOption(nativeNotificationWire.request)(
          '\u007B"_tag":"Show","version":1\u007D'
        )._tag
      ).toBe("None");
    })
);

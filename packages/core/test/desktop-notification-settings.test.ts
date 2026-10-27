import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import {
  MacNotificationPermission,
  NotificationSettingsRequest,
  NotificationSettingsReply,
  notificationSettingsReplyMatches,
  notificationSettingsWire,
} from "../src/desktop-bridge.js";

it.effect.prop(
  "notification settings codecs preserve only versioned intents and never carry caller URLs",
  {
    open: Schema.Boolean,
    url: Schema.String,
  },
  ({ open, url }) =>
    Effect.gen(function* notificationSettingsCodec() {
      const request = open
        ? NotificationSettingsRequest.cases.Open.make({ version: 1 })
        : NotificationSettingsRequest.cases.Read.make({ version: 1 });

      const encoded = yield* Schema.encodeEffect(
        notificationSettingsWire.request
      )(request);

      expect(
        yield* Schema.decodeEffect(notificationSettingsWire.request)(encoded)
      ).toEqual(request);

      for (const extra of [
        { ...request, url },
        { ...request, version: 2 },
        { ...request, kind: "Grant" },
      ]) {
        expect(
          Option.isNone(
            Schema.decodeOption(notificationSettingsWire.request, {
              onExcessProperty: "error",
            })(JSON.stringify(extra))
          )
        ).toBe(true);
      }

      expect(
        notificationSettingsReplyMatches(
          request,
          NotificationSettingsReply.cases.Requested.make({ version: 1 })
        )
      ).toBe(open);
      expect(
        notificationSettingsReplyMatches(
          request,
          NotificationSettingsReply.cases.Read.make({
            permission: { authorization: "unknown", supported: true },
            version: 1,
          })
        )
      ).toBe(!open);
    })
);

it.effect.prop(
  "native support cannot encode granted or denied macOS authorization",
  {
    supported: Schema.Boolean,
  },
  ({ supported }) =>
    Effect.sync(() => {
      expect(
        Schema.is(MacNotificationPermission)({
          authorization: "unknown",
          supported,
        })
      ).toBe(true);

      for (const authorization of ["granted", "denied", "default"]) {
        expect(
          Schema.is(MacNotificationPermission)({ authorization, supported })
        ).toBe(false);
      }
    })
);

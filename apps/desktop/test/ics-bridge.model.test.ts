import {
  IcsSaveOutcome,
  desktopWire,
  icsSaveByteLimit,
  icsSaveParseOptions,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Exit, Match, Option, Schema } from "effect";

import { icsBridgeFixture } from "./ics-bridge-fixture.js";
import { calendarText } from "./ics-save-fixture.js";

it.effect.prop(
  "the public preload bridge sends exact bounded ICS bytes and preserves the native terminal outcome",
  {
    padding: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 2048, minimum: 0 }))
    ),
    result: Arbitrary.schema(Schema.Literals(["Saved", "Cancelled", "Failed"])),
  },
  ({ padding, result }) =>
    Effect.gen(function* bridgeHistory() {
      const calls: string[] = [];

      const outcome = Match.value(result).pipe(
        Match.when("Failed", () =>
          IcsSaveOutcome.cases.Failed.make({ reason: "write" })
        ),
        Match.when("Cancelled", () => IcsSaveOutcome.cases.Cancelled.make({})),
        Match.when("Saved", () => IcsSaveOutcome.cases.Saved.make({})),
        Match.exhaustive
      );

      const fixture = icsBridgeFixture(
        // oxlint-disable-next-line typescript/promise-function-async -- The owned transport fake returns native wire text without starting another Effect runtime.
        (message) => {
          calls.push(message);

          return Promise.resolve(JSON.stringify(outcome));
        }
      );

      const save = Option.getOrThrow(
        Option.fromUndefinedOr(fixture.bridge.saveIcs)
      );

      const request = {
        bytes: new TextEncoder().encode(calendarText(256 + padding)),
        suggestedName: "résumé.ics",
      };

      const reply = yield* Effect.promise(
        // @effect-diagnostics-next-line asyncFunction:off -- The test exercises the public Promise bridge rather than bypassing its request and reply codecs.
        async () => await save(request)
      );

      expect(reply).toEqual(outcome);
      expect(calls).toHaveLength(1);

      const received = yield* Schema.decodeEffect(
        desktopWire.saveIcs,
        icsSaveParseOptions
      )(Option.getOrThrow(Option.fromUndefinedOr(calls[0])));

      expect(received).toEqual(request);
      expect(fixture.state.rejections).toBe(0);
    })
);

it.effect(
  "older transports expose no save capability, while invalid renderer requests never reach IPC",
  () =>
    Effect.gen(function* oldBridge() {
      expect(icsBridgeFixture().bridge.saveIcs).toBeUndefined();
      const calls: string[] = [];

      const fixture = icsBridgeFixture(
        // oxlint-disable-next-line typescript/promise-function-async -- This fake records whether the public bridge admitted a request before returning a native reply.
        (message) => {
          calls.push(message);

          return Promise.resolve('{"_tag":"Saved"}');
        }
      );

      const save = Option.getOrThrow(
        Option.fromUndefinedOr(fixture.bridge.saveIcs)
      );

      for (const request of [
        {
          bytes: new TextEncoder().encode(calendarText()),
          suggestedName: "../renderer.ics",
        },
        {
          bytes: new TextEncoder().encode(calendarText()),
          path: "/private/renderer.ics",
          suggestedName: "events.ics",
        },
        {
          bytes: new TextEncoder().encode(calendarText(icsSaveByteLimit + 1)),
          suggestedName: "events.ics",
        },
      ]) {
        const reply = yield* Effect.promise(
          // @effect-diagnostics-next-line asyncFunction:off -- The explicit native Promise boundary must refuse invalid requests before IPC.
          async () => await save(request)
        );

        expect(reply).toEqual(
          IcsSaveOutcome.cases.Failed.make({ reason: "invalid" })
        );
        expect(calls).toEqual([]);
      }

      expect(fixture.state.rejections).toBe(3);
    })
);

it.effect(
  "malformed native replies cannot become Saved, including a forged returned path",
  () =>
    Effect.gen(function* invalidReply() {
      for (const message of [
        "{",
        "null",
        '{"_tag":"Saved","path":"/private/file.ics"}',
        '{"_tag":"Failed","reason":"/private/failure"}',
      ]) {
        const fixture = icsBridgeFixture(
          // oxlint-disable-next-line typescript/promise-function-async -- The fake native transport supplies deliberately invalid wire text to the real bridge decoder.
          () => Promise.resolve(message)
        );

        const save = Option.getOrThrow(
          Option.fromUndefinedOr(fixture.bridge.saveIcs)
        );

        const reply = yield* Effect.tryPromise({
          catch: () => "invalidReply",
          // @effect-diagnostics-next-line asyncFunction:off -- This boundary observes rejection from the real isolated bridge without an Effect runner.
          try: async () =>
            await save({
              bytes: new TextEncoder().encode(calendarText()),
              suggestedName: "events.ics",
            }),
        }).pipe(Effect.exit);

        expect(Exit.isFailure(reply)).toBe(true);
        expect(fixture.state.rejections).toBe(1);
      }
    })
);

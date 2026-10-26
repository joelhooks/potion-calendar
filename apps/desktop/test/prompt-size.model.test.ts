import { PromptSize, promptWire } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Schema } from "effect";

import { createPromptBridge } from "../src/prompt-client.js";
import {
  promptFallbackHeight,
  promptMeasuredHeight,
} from "../src/prompt-size.js";

it.effect.prop(
  "measured content is clamped, stale revisions cannot resize and equal reports stop observer feedback",
  {
    area: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 2400, minimum: 100 }))
    ),
    height: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 10_000, minimum: -10_000 }))
    ),
    revision: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 100, minimum: 1 }))
    ),
  },
  ({ height, area, revision }) =>
    Effect.gen(function* measuredHistory() {
      const expected = Math.min(area, Math.max(140, height));

      const report = yield* Schema.decodeEffect(promptWire.size)(
        yield* Schema.encodeEffect(promptWire.size)({ height, revision })
      );

      expect(promptMeasuredHeight(report, revision, -1, area)).toBe(expected);
      expect(
        promptMeasuredHeight(report, revision + 1, -1, area)
      ).toBeUndefined();
      expect(
        promptMeasuredHeight(report, revision, expected, area)
      ).toBeUndefined();
      expect(
        promptMeasuredHeight(
          { height: Number.NaN, revision },
          revision,
          -1,
          area
        )
      ).toBeUndefined();
      expect(promptMeasuredHeight(report, revision, -1, area, 28)).toBe(
        Math.min(area, Math.max(140, height) + 28)
      );
      expect(promptFallbackHeight(1, area)).toBe(Math.min(area, 170));
      expect(promptFallbackHeight(20, area)).toBe(Math.min(area, 2070));
    })
);

it.effect(
  "real preload codec sends measured height and revision only, rejecting non-finite reports",
  () =>
    Effect.gen(function* measurementCodec() {
      const sent: string[] = [];
      let rejected = 0;
      const initial = Promise.resolve("");

      const bridge = createPromptBridge({
        act: () => {},
        // oxlint-disable-next-line typescript/promise-function-async -- The owned preload port returns a pre-settled native Promise without creating an async Effect boundary.
        read: () => initial,
        rejected: () => {
          rejected += 1;
        },
        reportSize: (message) => {
          sent.push(message);
        },
        soundReply: () => {},
        subscribe: () => () => {},
        subscribeSound: () => () => {},
      });

      bridge.reportSize?.({ height: 250, revision: 8 });
      bridge.reportSize?.({ height: Number.POSITIVE_INFINITY, revision: 8 });
      expect(sent).toHaveLength(1);
      expect(
        yield* Schema.decodeUnknownEffect(promptWire.size)(sent[0])
      ).toEqual({
        height: 250,
        revision: 8,
      });
      expect(rejected).toBe(1);
    })
);

it.effect(
  "measurement JSON refuses non-finite height and has a safe one-card fallback before any report",
  () =>
    Effect.sync(() => {
      expect(
        Option.isNone(
          Schema.decodeOption(PromptSize)({
            height: Number.POSITIVE_INFINITY,
            revision: 1,
          })
        )
      ).toBe(true);
      expect(
        Option.isNone(
          Schema.decodeOption(promptWire.size)('{"height":null,"revision":1}')
        )
      ).toBe(true);
      expect(
        promptMeasuredHeight({ height: 170.1, revision: 1 }, 1, 170, 1000)
      ).toBe(171);
      expect(promptFallbackHeight(1, 1000)).toBe(170);
    })
);

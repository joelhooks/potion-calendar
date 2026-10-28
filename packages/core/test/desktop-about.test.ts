import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { AboutReply, AboutRequest, aboutWire } from "../src/desktop-bridge.js";

it.effect.prop(
  "About accepts only the versioned intent, never caller metadata or destinations",
  { text: Schema.String },
  ({ text }) =>
    Effect.gen(function* aboutContract() {
      const request = AboutRequest.make({ version: 1 });
      const encoded = yield* Schema.encodeEffect(aboutWire.request)(request);
      expect(yield* Schema.decodeEffect(aboutWire.request)(encoded)).toEqual(
        request
      );

      for (const invalid of [
        { ...request, url: text },
        { ...request, metadata: text },
        { ...request, title: text },
        { version: 2 },
        {},
      ]) {
        expect(
          Option.isNone(
            Schema.decodeOption(aboutWire.request, {
              onExcessProperty: "error",
            })(JSON.stringify(invalid))
          )
        ).toBe(true);
      }

      for (const reply of [
        AboutReply.cases.Requested.make({ version: 1 }),
        AboutReply.cases.Refused.make({ reason: "unsupported", version: 1 }),
        AboutReply.cases.Failed.make({ message: text, version: 1 }),
      ]) {
        const wire = yield* Schema.encodeEffect(aboutWire.reply)(reply);
        expect(yield* Schema.decodeEffect(aboutWire.reply)(wire)).toEqual(
          reply
        );
      }

      expect(
        Option.isNone(
          Schema.decodeOption(aboutWire.reply)(
            ' {"_tag":"Visible","version":1}'
          )
        )
      ).toBe(true);
    })
);

import {
  PromptAction,
  PromptView,
  promptWire,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { attachmentMeeting } from "./prompt-attachment-fixture.js";

it.effect(
  "the prompt codec accepts attachment intent and preserves its index and URL match key",
  () =>
    Effect.gen(function* attachmentContract() {
      const action = {
        action: "attachment",
        index: 1,
        key: attachmentMeeting.key,
        url: "https://files.example.test/one",
      };

      const decoded = Schema.decodeUnknownOption(PromptAction)(action);
      expect(Option.isSome(decoded)).toBe(true);
      expect(Option.getOrNull(decoded)).toEqual(action);

      if (Option.isSome(decoded)) {
        expect(
          yield* Schema.decodeUnknownEffect(promptWire.action)(
            yield* Schema.encodeEffect(promptWire.action)(decoded.value)
          )
        ).toEqual(action);
      }
    })
);

it.effect(
  "the prompt view codec preserves only the saved attachment title and URL handoff fields",
  () =>
    Effect.gen(function* viewContract() {
      const attachments = [
        {
          iconUrl: "https://icons.example.test/private",
          mimeType: "private/type",
          title: "Saved document",
          url: "https://files.example.test/one",
        },
      ];

      const decoded = yield* Schema.decodeUnknownEffect(PromptView)({
        events: [{ ...attachmentMeeting, attachments }],
        revision: 1,
      });

      expect(decoded.events[0]?.attachments).toEqual([
        { title: "Saved document", url: "https://files.example.test/one" },
      ]);
    })
);

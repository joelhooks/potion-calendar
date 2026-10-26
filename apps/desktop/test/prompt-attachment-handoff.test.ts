import {
  PromptAction,
  eligiblePromptAttachments,
  navigation,
  promptWire,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Match, Option, Schema } from "effect";

import { NativeIntent } from "../src/native-host.js";
import { promptActionIntent } from "../src/prompt-action.js";
import { openPromptAttachment } from "../src/prompt-actions.js";
import { createPromptBridge } from "../src/prompt-client.js";
import { attachmentMeeting } from "./prompt-attachment-fixture.js";

const origin = "https://calendar.example.test";

it.effect(
  "missing URL.parse fails closed without changing the browser global contract",
  () =>
    Effect.gen(function* unavailableParser() {
      const descriptor = Object.getOwnPropertyDescriptor(URL, "parse");
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          Object.defineProperty(URL, "parse", {
            configurable: true,
            value: undefined,
          });
        }),
        () =>
          Effect.sync(() => {
            if (descriptor === undefined) {
              Reflect.deleteProperty(URL, "parse");
            } else {
              Object.defineProperty(URL, "parse", descriptor);
            }
          })
      );
      expect(
        eligiblePromptAttachments(
          [{ title: "Saved", url: "https://files.example.test/a" }],
          origin
        )
      ).toEqual([]);
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "preload and intent handoff open only the same indexed current saved attachment, never a stale renderer URL",
  {
    index: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 19, minimum: 0 }))
    ),
    stale: Arbitrary.schema(
      Schema.Literals([
        "same",
        "reordered",
        "removed",
        "replaced",
        "other-account",
      ])
    ),
  },
  ({ index, stale }) =>
    Effect.gen(function* attachmentRace() {
      const attachments = Array.from({ length: 20 }, (_, position) => ({
        title: `Saved ${position}`,
        url: `https://files.example.test/${position}`,
      }));

      const rendered = attachments[index];
      expect(rendered).toBeDefined();

      if (rendered === undefined) {
        return;
      }

      const action = {
        action: "attachment",
        index,
        key: attachmentMeeting.key,
        url: rendered.url,
      } satisfies typeof PromptAction.Type;

      const messages: string[] = [];

      const initial = Promise.resolve("");

      const bridge = createPromptBridge({
        act: (message) => {
          messages.push(message);
        },
        // oxlint-disable-next-line typescript/promise-function-async -- The owned preload port returns a pre-settled native Promise without creating an async Effect boundary.
        read: () => initial,
        rejected: () => {
          throw new Error("Unexpected rejected attachment payload");
        },
        soundReply: () => {},
        subscribe: () => () => {},
        subscribeSound: () => () => {},
      });

      bridge.act(action);
      expect(messages).toHaveLength(1);

      const decoded = yield* Schema.decodeUnknownEffect(promptWire.action)(
        messages[0]
      );

      const intent = promptActionIntent(decoded, attachmentMeeting);
      expect(intent).toEqual(
        NativeIntent.cases.OpenPromptAttachment.make({
          index,
          key: attachmentMeeting.key,
          url: rendered.url,
        })
      );

      if (intent === undefined || !("index" in intent)) {
        throw new Error("Expected attachment intent");
      }

      const current = Match.value(stale).pipe(
        Match.when("reordered", () =>
          [...attachments.slice(1), attachments[0]].filter(
            (entry) => entry !== undefined
          )
        ),
        Match.when("removed", () => attachments.slice(0, index)),
        Match.when("replaced", () =>
          attachments.map((entry, position) =>
            position === index
              ? { ...entry, url: "https://replacement.example.test/" }
              : entry
          )
        ),
        Match.orElse(() => attachments)
      );

      const event = {
        ...attachmentMeeting,
        attachments: current,
        key:
          stale === "other-account"
            ? { ...attachmentMeeting.key, accountId: "foreign" }
            : attachmentMeeting.key,
      };

      const opened: string[] = [];
      yield* openPromptAttachment(
        {
          action: "attachment",
          index: intent.index,
          key: intent.key,
          url: intent.url,
        },
        { events: [event] },
        (url) =>
          Effect.sync(() => {
            if (navigation(url, origin) === "browser") {
              opened.push(url);
            }
          })
      );
      expect(opened).toEqual(stale === "same" ? [rendered.url] : []);
    }).pipe(Effect.scoped)
);

it.effect(
  "filters saved attachment URLs before rendering including IPC-injected unsafe links, preserves order and caps twenty",
  () =>
    Effect.sync(() => {
      const saved = [
        // oxlint-disable-next-line no-script-url -- Untrusted attachment input must never be published or opened as executable content.
        { title: "javascript", url: "javascript:alert(1)" },
        { title: "local", url: "file:///tmp/a" },
        { title: "same origin", url: `${origin}/private` },
        { title: "http", url: "http://files.example.test/a" },
        {
          title: "credentials",
          url: "https://user:secret@files.example.test/a",
        },
        { title: "mailto", url: "mailto:guest@example.test" },
        ...Array.from({ length: 23 }, (_, index) => ({
          title: `Good ${index}`,
          url: `https://files.example.test/${index}`,
        })),
      ];

      expect(eligiblePromptAttachments(saved, origin)).toEqual(
        saved.slice(6, 26)
      );
      expect(eligiblePromptAttachments(saved)).toEqual([]);
      expect(
        Option.isNone(
          Schema.decodeOption(PromptAction)({
            action: "attachment",
            index: 20,
            key: attachmentMeeting.key,
            url: "https://files.example.test/a",
          })
        )
      ).toBe(true);
    })
);

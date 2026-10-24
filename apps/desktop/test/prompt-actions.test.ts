import {
  defaultDesktopPreferences,
  promptWire,
} from "@calendar/core/desktop-bridge";
import type {
  AgendaEventValue,
  PromptAction,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { waitFor } from "@xstate/effect";
import { Arbitrary, Effect, Predicate, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";

import { DesktopError } from "../src/config.js";
import type { NativeIntentValue } from "../src/native-host.js";
import { navigation } from "../src/navigation.js";
import { promptActionIntent } from "../src/prompt-action.js";
import {
  emailPromptParticipants,
  requestPromptSnooze,
} from "../src/prompt-actions.js";
import { createPromptBridge } from "../src/prompt-client.js";
import { promptEmailUrl } from "../src/prompt-email.js";
import { startPrompt } from "../src/prompt-machine.js";

const meeting: AgendaEventValue = {
  allDay: false,
  calendarColor: "#64748b",
  conferenceUrl: "https://meet.example.test/room",
  end: 3_600_000,
  hasLocation: false,
  hasParticipants: true,
  key: { accountId: "work", calendarId: "primary", eventId: "recipient" },
  participantEmails: ["guest+tag@example.test"],
  responseStatus: "accepted",
  start: 120_000,
  title: "Saved & private meeting",
};

const bridgeFixture = () => {
  const intents: NativeIntentValue[] = [];

  const bridge = createPromptBridge({
    act: (message) => {
      const action = Schema.decodeSync(promptWire.action)(message);
      const intent = promptActionIntent(action, meeting);

      if (intent !== undefined) {
        intents.push(intent);
      }
    },
    // @effect-diagnostics-next-line asyncFunction:off -- The faithful preload read port preserves the native Promise API with a real encoded view.
    read: async () =>
      await Promise.resolve(
        Schema.encodeSync(promptWire.view)({ events: [meeting], revision: 1 })
      ),
    rejected: () => {
      expect.fail("The preload rejected a valid prompt action");
    },
    soundReply: () => {},
    subscribe: () => () => {},
    subscribeSound: () => () => {},
  });

  return { bridge, intents };
};

it.effect(
  "the actual preload view codec preserves permitted participant emails",
  () =>
    Effect.gen(function* decodedView() {
      const { bridge } = bridgeFixture();

      const view = yield* Effect.promise(
        // @effect-diagnostics-next-line asyncFunction:off -- The real preload reads an encoded native-view Promise from its faithful test port.
        async () => await bridge.getView()
      );

      expect(view.events[0]?.participantEmails).toEqual([
        "guest+tag@example.test",
      ]);
    })
);

it.effect.each([
  { action: "email", tag: "EmailPrompt" },
  { action: "snooze", tag: "SnoozePrompt" },
  { action: "show", tag: "ShowEvent" },
  { action: "dismiss", tag: "DismissPrompt" },
  { action: "join", tag: "Join" },
] satisfies readonly {
  readonly action: (typeof PromptAction.Type)["action"];
  readonly tag: string;
}[])(
  "the actual preload codec and native adapter preserve %s",
  ({ action, tag }) =>
    Effect.sync(() => {
      const { bridge, intents } = bridgeFixture();
      bridge.act({ action, key: meeting.key });
      expect(intents).toHaveLength(1);
      const [intent] = intents;
      expect(intent?._tag).toBe(tag);

      if (intent === undefined) {
        throw new Error("The asserted native intent is absent");
      }

      if (Predicate.isTagged(intent, "Join")) {
        expect(intent.request.key).toEqual(meeting.key);
      } else if ("key" in intent) {
        expect(intent.key).toEqual(meeting.key);
      } else {
        expect.fail("The action lost its saved event key");
      }
    })
);

it.effect(
  "Email uses only the current saved row, hands off once, and never substitutes another account's same event ID",
  () =>
    Effect.gen(function* emailRecipient() {
      const { bridge, intents } = bridgeFixture();
      bridge.act({ action: "email", key: meeting.key });
      const [intent] = intents;
      expect(intent?._tag).toBe("EmailPrompt");

      if (intent === undefined || !Predicate.isTagged(intent, "EmailPrompt")) {
        throw new Error("The asserted Email intent is absent");
      }

      const opened = yield* Ref.make<readonly string[]>([]);

      const open = (url: string) =>
        Ref.update(opened, (urls) => [...urls, url]);

      yield* emailPromptParticipants(
        intent.key,
        {
          events: [{ ...meeting, participantEmails: ["latest@example.test"] }],
        },
        open
      );
      expect(yield* Ref.get(opened)).toEqual([
        "mailto:latest@example.test?subject=Saved%20%26%20private%20meeting",
      ]);
      yield* emailPromptParticipants(intent.key, { events: [] }, open);
      yield* emailPromptParticipants(
        intent.key,
        {
          events: [
            {
              ...meeting,
              key: { ...meeting.key, accountId: "other-person-account" },
            },
          ],
        },
        open
      );
      yield* emailPromptParticipants(
        intent.key,
        { events: [{ ...meeting, participantEmails: [] }] },
        open
      );
      expect(yield* Ref.get(opened)).toHaveLength(1);
    })
);

it.effect(
  "Snooze's native handler reads fresh Effect-clock time and reaches the existing actor without clearing it",
  () =>
    Effect.gen(function* snoozeRecipient() {
      yield* TestClock.setTime(120_000);
      const presentations = yield* Ref.make(0);

      const actor = yield* startPrompt(
        {
          close: Effect.void,
          present: () => Ref.update(presentations, (count) => count + 1),
        },
        {
          now: 120_000,
          preferences: defaultDesktopPreferences(),
          snapshot: { events: [meeting] },
        }
      );

      yield* waitFor(actor, (snapshot) => snapshot.matches("visible"), {
        timeout: "1 second",
      }).pipe(Effect.orDie);
      yield* TestClock.adjust(12_345);
      const { bridge, intents } = bridgeFixture();
      bridge.act({ action: "snooze", key: meeting.key });
      const [intent] = intents;
      expect(intent?._tag).toBe("SnoozePrompt");

      if (intent === undefined || !Predicate.isTagged(intent, "SnoozePrompt")) {
        throw new Error("The asserted Snooze intent is absent");
      }

      yield* requestPromptSnooze(actor, intent.key);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(actor.getSnapshot().context.visible).toEqual([]);
      expect(actor.getSnapshot().context.remembered.size).toBe(0);
      expect([...actor.getSnapshot().context.snoozed.values()]).toEqual([
        { start: meeting.start, until: 192_345 },
      ]);
      yield* TestClock.adjust(59_999);
      expect(actor.getSnapshot().context.visible).toEqual([]);
      yield* TestClock.adjust(1);
      yield* waitFor(actor, (snapshot) => snapshot.matches("visible"), {
        timeout: "1 second",
      }).pipe(Effect.orDie);
      expect(actor.getSnapshot().context.visible).toEqual([meeting]);
      expect(yield* Ref.get(presentations)).toBe(2);
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "owned mailto formatting encodes subjects and is accepted by the existing external scheme allowlist",
  {
    subject: Arbitrary.schema(
      Schema.Literals([
        "Saved & private meeting",
        "Team ? # & /",
        "日本語",
        "",
        "Line\nbreak",
      ])
    ),
  },
  ({ subject }) =>
    Effect.sync(() => {
      const href = promptEmailUrl({ ...meeting, title: subject });
      expect(href).toBeDefined();

      if (href === undefined) {
        throw new Error("The asserted mailto is absent");
      }

      expect(navigation(href, "https://calendar.example.test")).toBe("browser");
      expect(URL.parse(href)?.searchParams.get("subject")).toBe(subject);
      expect(href.startsWith("mailto:guest%2Btag@example.test?")).toBe(true);
    })
);

it.effect(
  "empty, malformed and oversized handoffs fail closed; an OS refusal remains typed",
  () =>
    Effect.gen(function* refusedEmail() {
      expect(
        promptEmailUrl({ ...meeting, participantEmails: [] })
      ).toBeUndefined();
      expect(
        promptEmailUrl({ ...meeting, participantEmails: ["\uD800"] })
      ).toBeUndefined();
      expect(
        promptEmailUrl({ ...meeting, title: "x".repeat(2001) })
      ).toBeUndefined();

      const result = yield* emailPromptParticipants(
        meeting.key,
        { events: [meeting] },
        () => Effect.fail(new DesktopError({ message: "OS handoff refused" }))
      ).pipe(Effect.result);

      expect(result._tag).toBe("Failure");
    })
);

import {
  AgendaSnapshot,
  defaultDesktopPreferences,
  promptWire,
} from "@calendar/core/desktop-bridge";
import type {
  AgendaSnapshotValue,
  PromptView,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { send, waitFor } from "@xstate/effect";
import { Effect, Queue, Ref, Schema, Stream } from "effect";
import { TestClock } from "effect/testing";

import { desktopAgendaReceiver } from "../src/agenda-receiver.js";
import { startNativeHost } from "../src/native-host.js";
import { startPrompt } from "../src/prompt-machine.js";
import {
  nextPromptView,
  projectPromptPreferences,
} from "../src/prompt-preferences.js";
import { makeNativeSettings } from "../src/settings.js";
import {
  promptMeeting,
  promptNow,
  promptPreferences,
} from "./prompt-preferences-fixture.js";

it.effect(
  "the registered agenda receiver and native settings host publish current preferences through the real prompt actor and wire",
  () =>
    Effect.gen(function* nativePreferenceRecipients() {
      yield* TestClock.setTime(promptNow);
      const writes = yield* Ref.make<string[]>([]);

      const native = yield* makeNativeSettings({
        login: Effect.succeed(false),
        read: Effect.succeedNone,
        register: (accelerator) =>
          Effect.succeed(accelerator !== "Ctrl+Unavailable"),
        setLogin: () => Effect.void,
        unregister: () => Effect.void,
        write: (message) =>
          Ref.update(writes, (values) => [...values, message]),
      });

      const received = yield* Ref.make<(typeof PromptView.Type)[]>([]);
      const delivered = yield* Queue.unbounded<typeof PromptView.Type>();

      const prompt = yield* startPrompt(
        {
          close: Effect.void,
          present: (events, presentation) =>
            Effect.gen(function* receivePromptView() {
              const message = yield* Schema.encodeEffect(promptWire.view)(
                nextPromptView(
                  { events: [], revision: (yield* Ref.get(received)).length },
                  events,
                  presentation
                )
              ).pipe(Effect.orDie);

              const view = yield* Schema.decodeEffect(promptWire.view)(
                message
              ).pipe(Effect.orDie);

              yield* Ref.update(received, (values) => [...values, view]);
              yield* Queue.offer(delivered, view);
            }),
        },
        {
          now: promptNow,
          preferences: yield* native.preferences,
          snapshot: { events: [] },
        }
      );

      const host = yield* startNativeHost(
        {
          intents: Stream.empty,
          perform: () => Effect.void,
          render: (view) =>
            send(prompt, {
              now: view.now,
              preferences: view.preferences,
              snapshot: view.agenda,
              type: "Input",
            }),
        },
        { now: promptNow, preferences: yield* native.preferences }
      );

      yield* waitFor(host.actor, (s) => s.matches({ active: "idle" }), {
        timeout: "1 second",
      }).pipe(Effect.orDie);
      const accepted = yield* Queue.unbounded<AgendaSnapshotValue>();
      let refusals = 0;

      const receive = desktopAgendaReceiver("https://calendar.example.test", {
        accepted: (snapshot) => {
          Queue.offerUnsafe(accepted, snapshot);
        },
        rejected: () => {
          refusals += 1;
        },
        trusted: (value: boolean) => value,
      });

      receive(
        false,
        JSON.stringify({ events: [promptMeeting], promptPreferences })
      );
      expect(yield* Queue.size(accepted)).toBe(0);
      expect(refusals).toBe(0);
      receive(true, "not json");
      expect(refusals).toBe(1);
      receive(
        true,
        JSON.stringify({
          events: [
            {
              ...promptMeeting,
              attachments: [
                { title: "own", url: "https://calendar.example.test/private" },
                ...(promptMeeting.attachments ?? []),
              ],
            },
          ],
          promptPreferences: {
            ...promptPreferences,
            joinShortcut: "Ctrl+Forged",
          },
        })
      );
      const snapshot = yield* Queue.take(accepted);
      expect(snapshot.promptPreferences).toEqual({
        ...promptPreferences,
        joinShortcut: "Ctrl+Forged",
      });
      expect(snapshot.events[0]?.attachments).toEqual(
        promptMeeting.attachments
      );
      yield* send(host.actor, { snapshot, type: "Agenda" });
      yield* waitFor(prompt, (s) => s.matches("visible"), {
        timeout: "1 second",
      }).pipe(Effect.orDie);
      expect((yield* Queue.take(delivered)).preferences).toEqual(
        promptPreferences
      );

      for (const shortcut of ["Ctrl+Alt+K", null, "Ctrl+Unavailable"]) {
        const reply = yield* native.save({
          ...defaultDesktopPreferences(),
          joinShortcut: shortcut,
        });

        yield* send(host.actor, { settings: reply.settings, type: "Settings" });
        yield* waitFor(host.actor, (s) => s.matches({ active: "idle" }), {
          timeout: "1 second",
        }).pipe(Effect.orDie);
        yield* waitFor(prompt, (s) => s.matches("visible"), {
          timeout: "1 second",
        }).pipe(Effect.orDie);
        expect((yield* Queue.take(delivered)).preferences?.joinShortcut).toBe(
          shortcut === "Ctrl+Unavailable" ? null : shortcut
        );
      }

      const off = yield* native.save({
        ...defaultDesktopPreferences(),
        menuBar: false,
      });

      yield* send(host.actor, { settings: off.settings, type: "Settings" });
      yield* waitFor(host.actor, (s) => s.matches({ active: "idle" }), {
        timeout: "1 second",
      }).pipe(Effect.orDie);
      yield* waitFor(prompt, (s) => s.matches("idle"), {
        timeout: "1 second",
      }).pipe(Effect.orDie);
      expect(
        projectPromptPreferences(snapshot, off.settings.preferences)
          ?.joinShortcut
      ).toBeNull();
      expect(prompt.getSnapshot().context.visible).toEqual([]);
      expect(yield* Ref.get(writes)).toHaveLength(4);
      yield* Queue.shutdown(accepted);
      yield* Queue.shutdown(delivered);
    }).pipe(Effect.scoped)
);

it.effect(
  "main suppresses forged hints with menu bar off and never retains legacy or invalid optional metadata",
  () =>
    Effect.gen(function* metadataFallback() {
      const native = {
        ...defaultDesktopPreferences(),
        joinShortcut: "Ctrl+Saved",
      };

      const valid = yield* Schema.decodeEffect(AgendaSnapshot)({
        events: [promptMeeting],
        promptPreferences: {
          ...promptPreferences,
          joinShortcut: "Ctrl+Renderer",
        },
      });

      expect(projectPromptPreferences(valid, native)?.joinShortcut).toBe(
        "Ctrl+Saved"
      );
      expect(
        projectPromptPreferences(valid, { ...native, menuBar: false })
          ?.joinShortcut
      ).toBeNull();

      const old = yield* Schema.decodeEffect(AgendaSnapshot)({
        events: [promptMeeting],
      });

      expect(projectPromptPreferences(old, native)).toBeUndefined();

      const invalid = yield* Schema.decodeEffect(AgendaSnapshot)({
        events: [promptMeeting],
        promptPreferences: { ...promptPreferences, joinShortcut: "J" },
      });

      expect(invalid.events).toEqual([promptMeeting]);
      expect(projectPromptPreferences(invalid, native)).toBeUndefined();
    })
);

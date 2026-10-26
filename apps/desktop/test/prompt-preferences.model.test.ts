import {
  defaultDesktopPreferences,
  promptWire,
} from "@calendar/core/desktop-bridge";
import type {
  AgendaEventValue,
  PromptView,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { send, waitFor } from "@xstate/effect";
import { Arbitrary, Deferred, Effect, Ref, Schema } from "effect";

import { startPrompt } from "../src/prompt-machine.js";
import type { PromptPresentation } from "../src/prompt-machine.js";
import { nextPromptView } from "../src/prompt-preferences.js";
import { revealWithSound } from "../src/sound-machine.js";
import {
  promptMeeting,
  promptNow,
  promptPreferences,
} from "./prompt-preferences-fixture.js";

it.effect(
  "a preference change during the real present child reaches the encoded view with one reveal and one sound per addition",
  () =>
    Effect.gen(function* pendingPreferenceRefresh() {
      const loaded = yield* Deferred.make<boolean>();
      const entered = yield* Deferred.make<boolean>();
      const views = yield* Ref.make<(typeof PromptView.Type)[]>([]);
      const loads = yield* Ref.make(0);
      const reveals = yield* Ref.make(0);
      const sounds = yield* Ref.make(0);
      const native = defaultDesktopPreferences();

      const actor = yield* startPrompt(
        {
          close: Effect.void,
          present: (
            events: readonly AgendaEventValue[],
            presentation: PromptPresentation
          ) =>
            Effect.gen(function* present() {
              const view = nextPromptView(
                { events: [], revision: (yield* Ref.get(views)).length },
                events,
                presentation
              );

              const encoded = yield* Schema.encodeEffect(promptWire.view)(
                view
              ).pipe(Effect.orDie);

              const received = yield* Schema.decodeEffect(promptWire.view)(
                encoded
              ).pipe(Effect.orDie);

              yield* Ref.update(views, (previous) => [...previous, received]);

              if (!presentation.reveal) {
                return;
              }

              yield* revealWithSound(presentation.sound, {
                load: () =>
                  Ref.update(loads, (n) => n + 1).pipe(
                    Effect.andThen(Deferred.succeed(entered, true)),
                    Effect.andThen(Deferred.await(loaded))
                  ),
                play: () => Ref.update(sounds, (n) => n + 1),
                reveal: Ref.update(reveals, (n) => n + 1),
              });
            }),
        },
        {
          now: promptNow,
          preferences: native,
          snapshot: { events: [promptMeeting], promptPreferences },
        }
      );

      yield* Deferred.await(entered);
      yield* send(actor, {
        now: promptNow,
        preferences: { ...native, joinShortcut: "Ctrl+Alt+K" },
        snapshot: {
          events: [promptMeeting],
          promptPreferences: {
            ...promptPreferences,
            joinShortcut: "Ctrl+X",
            theme: "light",
            timeFormat: "12",
          },
        },
        type: "Input",
      });
      yield* Deferred.succeed(loaded, true);
      yield* waitFor(actor, (s) => s.matches("visible"), {
        timeout: "1 second",
      }).pipe(Effect.orDie);
      expect((yield* Ref.get(views)).at(-1)?.preferences).toEqual({
        ...promptPreferences,
        joinShortcut: "Ctrl+Alt+K",
        theme: "light",
        timeFormat: "12",
      });
      expect(yield* Ref.get(views)).toHaveLength(2);
      expect(yield* Ref.get(loads)).toBe(1);
      expect(yield* Ref.get(reveals)).toBe(1);
      expect(yield* Ref.get(sounds)).toBe(1);

      const second = {
        ...promptMeeting,
        key: { ...promptMeeting.key, eventId: "two" },
      };

      yield* send(actor, {
        snapshot: { events: [promptMeeting, second], promptPreferences },
        type: "Agenda",
      });
      yield* waitFor(
        actor,
        (s) => s.matches("visible") && s.context.visible.length === 2,
        { timeout: "1 second" }
      ).pipe(Effect.orDie);
      expect(yield* Ref.get(loads)).toBe(2);
      expect(yield* Ref.get(reveals)).toBe(2);
      expect(yield* Ref.get(sounds)).toBe(2);
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "an already-open prompt follows generated native and appearance updates without polling or another reveal",
  {
    history: Arbitrary.schema(
      Schema.Array(
        Schema.Struct({
          joinShortcut: Schema.NullOr(Schema.Literals(["Ctrl+J", "Ctrl+K"])),
          theme: Schema.Literals(["light", "dark"]),
          timeFormat: Schema.Literals(["12", "24"]),
        })
      ).check(Schema.isMinLength(1), Schema.isMaxLength(6))
    ),
  },
  ({ history }) =>
    Effect.gen(function* preferenceHistory() {
      const views = yield* Ref.make<PromptPresentation[]>([]);

      const actor = yield* startPrompt(
        {
          close: Effect.void,
          present: (_events, presentation) =>
            Ref.update(views, (previous) => [...previous, presentation]),
        },
        {
          now: promptNow,
          preferences: defaultDesktopPreferences(),
          snapshot: { events: [promptMeeting], promptPreferences },
        }
      );

      yield* waitFor(actor, (s) => s.matches("visible"), {
        timeout: "1 second",
      }).pipe(Effect.orDie);

      for (const change of history) {
        yield* send(actor, {
          now: promptNow,
          preferences: {
            ...defaultDesktopPreferences(),
            joinShortcut: change.joinShortcut,
          },
          snapshot: {
            events: [promptMeeting],
            promptPreferences: {
              ...promptPreferences,
              ...change,
              joinShortcut: "Ctrl+Forged",
            },
          },
          type: "Input",
        });
        yield* waitFor(
          actor,
          (s) =>
            s.matches("visible") &&
            s.context.preferences.joinShortcut === change.joinShortcut &&
            s.context.snapshot.promptPreferences?.theme === change.theme &&
            s.context.snapshot.promptPreferences.timeFormat ===
              change.timeFormat,
          { timeout: "1 second" }
        ).pipe(Effect.orDie);
        expect((yield* Ref.get(views)).at(-1)?.preferences).toEqual({
          ...promptPreferences,
          ...change,
        });
        expect((yield* Ref.get(views)).filter((p) => p.reveal)).toHaveLength(1);
      }

      yield* send(actor, {
        preferences: { ...defaultDesktopPreferences(), menuBar: false },
        type: "Settings",
      });
      yield* waitFor(actor, (s) => s.matches("idle"), {
        timeout: "1 second",
      }).pipe(Effect.orDie);
      expect(actor.getSnapshot().context.visible).toEqual([]);
      yield* send(actor, { snapshot: { events: [] }, type: "Agenda" });
      yield* send(actor, {
        preferences: defaultDesktopPreferences(),
        type: "Settings",
      });
      yield* waitFor(actor, (s) => s.matches("idle"), {
        timeout: "1 second",
      }).pipe(Effect.orDie);
      expect((yield* Ref.get(views)).filter((p) => p.reveal)).toHaveLength(1);
    }).pipe(Effect.scoped)
);

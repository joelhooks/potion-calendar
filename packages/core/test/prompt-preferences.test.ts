import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";

import {
  AgendaSnapshot,
  GlobalShortcut,
  PromptPreferences,
  PromptView,
  desktopWire,
  promptWire,
} from "../src/desktop-bridge.js";

it.effect.prop(
  "versioned prompt preferences survive both wire boundaries without changing events or revision",
  { preferences: Arbitrary.schema(PromptPreferences) },
  ({ preferences }) =>
    Effect.gen(function* preferenceRoundTrip() {
      const agenda = { events: [], promptPreferences: preferences };
      const view = { events: [], preferences, revision: 7 };
      expect(
        yield* Schema.decodeEffect(desktopWire.agenda)(
          yield* Schema.encodeEffect(desktopWire.agenda)(agenda)
        )
      ).toEqual(agenda);
      expect(
        yield* Schema.decodeEffect(promptWire.view)(
          yield* Schema.encodeEffect(promptWire.view)(view)
        )
      ).toEqual(view);
    })
);

it.effect(
  "legacy payloads and invalid optional metadata preserve valid content without a stale preference field",
  () =>
    Effect.gen(function* optionalMetadataFallback() {
      for (const preferences of [
        undefined,
        null,
        { joinShortcut: "Ctrl+J", theme: "dark", timeFormat: "24", version: 2 },
        { joinShortcut: "J", theme: "dark", timeFormat: "24", version: 1 },
        { joinShortcut: "Ctrl+J", theme: "auto", timeFormat: "24", version: 1 },
        {
          joinShortcut: "Ctrl+J",
          theme: "dark",
          timeFormat: "system",
          version: 1,
        },
      ]) {
        const agenda = yield* Schema.decodeUnknownEffect(AgendaSnapshot)({
          events: [],
          promptPreferences: preferences,
        });

        const view = yield* Schema.decodeUnknownEffect(PromptView)({
          events: [],
          preferences,
          revision: 9,
        });

        expect(agenda.events).toEqual([]);
        expect(agenda.promptPreferences).toBeUndefined();
        expect(view.events).toEqual([]);
        expect(view.revision).toBe(9);
        expect(view.preferences).toBeUndefined();
      }

      expect(
        Schema.decodeUnknownOption(PromptView)({
          events: "invalid",
          revision: 9,
        })._tag
      ).toBe("None");
    })
);

it.effect.prop(
  "the preference extension accepts no accelerator beyond the existing GlobalShortcut contract",
  { shortcut: Arbitrary.schema(Schema.String) },
  ({ shortcut }) =>
    Effect.sync(() => {
      const input = {
        joinShortcut: shortcut,
        theme: "light",
        timeFormat: "12",
        version: 1,
      };

      expect(Schema.decodeUnknownOption(PromptPreferences)(input)._tag).toBe(
        Schema.decodeUnknownOption(GlobalShortcut)(shortcut)._tag
      );
    })
);

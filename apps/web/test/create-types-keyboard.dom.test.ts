import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, pipe } from "effect";
import { AsyncData } from "foldkit";

import type { AppModel } from "../src/client/app.js";
import { selectedEvent } from "../src/client/keyboard/registry.js";
import {
  captureShortcutCommands,
  pressEditorShortcut,
  shortcutFixture,
} from "./editor-shortcut-fixture.js";

it.effect.each(["focusTime", "outOfOffice"] as const)(
  "saved %s cannot dispatch a participant-focus key to an omitted guest field",
  (eventType) =>
    Effect.gen(function* statusParticipantKey() {
      const base = shortcutFixture("without-conferencing");

      const model: AppModel = {
        ...base,
        calendar: {
          ...base.calendar,
          reads: base.calendar.reads.map((read) => ({
            ...read,
            events: pipe(
              read.events,
              AsyncData.map((data) => ({
                ...data,
                events: data.events.map((event): CalendarEventValue => ({
                  ...event,
                  eventType,
                })),
              }))
            ),
          })),
        },
      };

      expect(selectedEvent(model)?.source.eventType).toBe(eventType);
      const result = pressEditorShortcut(model, "p");
      expect(yield* captureShortcutCommands(result)).toHaveLength(0);
      expect(result.model.calendar.selected).toEqual(model.calendar.selected);
      expect(result.model.calendar.navigation).toBe(model.calendar.navigation);
    })
);

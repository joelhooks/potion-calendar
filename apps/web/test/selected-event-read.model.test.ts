import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import { calendarKey } from "../src/client/calendar-state.js";
import { commandChoices } from "../src/client/keyboard/choices.js";
import { SearchRoute } from "../src/layout/route.js";
import {
  providerOriginalHref,
  selectedReadFixture,
} from "./selected-event-read-fixture.js";

it.effect.prop(
  "Go to selection retains its key and current view while navigating and revealing only its calendar",
  {
    hidden: Schema.Boolean,
    mode: Schema.Literals(["day", "days", "week", "month"]),
    offset: Schema.Int.check(Schema.isBetween({ maximum: 720, minimum: -720 })),
    readOnly: Schema.Boolean,
    search: Schema.Boolean,
  },
  ({ hidden, mode, offset, readOnly, search }) =>
    Effect.sync(() => {
      const scenario = hidden ? "hidden-calendar" : "selected";

      const base = selectedReadFixture(
        readOnly && !hidden ? "read-only" : scenario
      );

      const model = {
        ...base,
        calendar: {
          ...base.calendar,
          navigation: {
            ...base.calendar.navigation,
            anchor: base.calendar.navigation.anchor + offset,
            mode,
          },
        },
        route: search ? SearchRoute.make({ q: "Product review" }) : base.route,
      };

      const opened = update(
        model,
        Message.KeyboardAction({ id: "commands" })
      ).model;

      expect(
        commandChoices(opened).find((choice) => choice.id === "go-to-selection")
          ?.disabled
      ).toBe(false);

      const result = update(
        opened,
        Message.KeyboardPick({ id: "go-to-selection" })
      );

      expect(result.model.calendar.selected).toEqual(base.calendar.selected);
      expect(result.model.calendar.navigation.mode).toBe(mode);
      expect(result.model.calendar.navigation.anchor).toBe(
        Date.UTC(2026, 9, 19) / 86_400_000
      );
      expect(result.model.calendar.hidden).not.toContain(
        calendarKey("work", "primary")
      );
      expect(
        result.model.calendar.hidden.filter(
          (key) => key !== calendarKey("work", "primary")
        )
      ).toEqual(
        base.calendar.hidden.filter(
          (key) => key !== calendarKey("work", "primary")
        )
      );
      expect(result.model.keyboard.screen).toBe("closed");
      expect(
        result.commands?.filter((command) => command.name === "SavePreferences")
      ).toHaveLength(hidden ? 1 : 0);
      expect(
        result.commands?.filter(
          (command) => command.name === "OpenProviderOriginal"
        )
      ).toHaveLength(0);
      expect(result.model.route._tag).toBe("Calendar");
    })
);

it.effect.prop(
  "catalog and stale dispatch refuse zero or multiple selections without inventing an event",
  {
    id: Schema.Literals(["go-to-selection", "open-in-provider"]),
    multiple: Schema.Boolean,
  },
  ({ multiple, id }) =>
    Effect.sync(() => {
      const current = selectedReadFixture(
        multiple ? "multiple" : "no-selection"
      );

      const open = update(
        current,
        Message.KeyboardAction({ id: "commands" })
      ).model;

      const row = commandChoices(open).find((choice) => choice.id === id);
      expect(row).toBeDefined();
      expect(row?.disabled).toBe(true);
      expect(update(open, Message.KeyboardPick({ id })).model).toBe(open);
      const bypass = update(open, Message.KeyboardAction({ id }));
      expect(bypass.model).toBe(open);
      expect(bypass.commands ?? []).toHaveLength(0);

      const previouslyOpen = update(
        selectedReadFixture("selected"),
        Message.KeyboardAction({ id: "commands" })
      ).model;

      const stale = {
        ...previouslyOpen,
        calendar: {
          ...previouslyOpen.calendar,
          selected: current.calendar.selected,
        },
      };

      const late = update(stale, Message.KeyboardPick({ id }));
      expect(late.model).toBe(stale);
      expect(late.commands ?? []).toHaveLength(0);
    })
);

it.effect.prop(
  "missing or unsafe provider originals disable only the provider command",
  { unsafe: Schema.Boolean },
  ({ unsafe }) =>
    Effect.sync(() => {
      const base = selectedReadFixture(unsafe ? "unsafe-url" : "no-url");

      const { model } = update(
        base,
        Message.KeyboardAction({ id: "commands" })
      );

      const rows = commandChoices(model);
      expect(
        rows.find((choice) => choice.id === "go-to-selection")?.disabled
      ).toBe(false);
      expect(
        rows.find((choice) => choice.id === "open-in-provider")?.disabled
      ).toBe(true);
      expect(
        update(model, Message.KeyboardAction({ id: "open-in-provider" }))
          .commands ?? []
      ).toHaveLength(0);
    })
);

it.effect(
  "provider opening is read-only and closes the catalog without navigating, revealing or joining a meeting",
  () =>
    Effect.sync(() => {
      for (const scenario of [
        "selected",
        "hidden-calendar",
        "read-only",
      ] as const) {
        const base = selectedReadFixture(scenario);

        const opened = update(
          base,
          Message.KeyboardAction({ id: "commands" })
        ).model;

        const result = update(
          opened,
          Message.KeyboardPick({ id: "open-in-provider" })
        );

        expect(result.commands?.map((command) => command.name)).toEqual([
          "OpenProviderOriginal",
        ]);
        expect(result.commands?.[0]?.args).toEqual({
          href: providerOriginalHref,
        });
        expect(result.model.calendar).toBe(base.calendar);
        expect(result.model.route).toBe(base.route);
        expect(result.model.keyboard.screen).toBe("closed");
      }
    })
);

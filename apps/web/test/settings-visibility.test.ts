import type { CalendarValue } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { calendarKey } from "../src/client/calendar-state.js";
import { VisibilityMigration } from "../src/client/settings/visibility-model.js";
import {
  calendarVisible,
  chooseVisibility,
  migrateVisibility,
} from "../src/client/settings/visibility.js";

const current = VisibilityMigration.cases.Current.make({});

const calendar = (
  id: string,
  selected: Option.Option<boolean>
): CalendarValue => {
  const value: CalendarValue = {
    accessRole: "owner",
    accountId: "work",
    calendarId: id,
    primary: false,
    timeZone: "UTC",
    title: id,
  };

  return Option.isSome(selected)
    ? { ...value, selected: selected.value }
    : value;
};

it.effect.prop(
  "an explicit local choice overrides Google's selected default, regardless of Google's hidden flag",
  {
    hidden: Schema.Boolean,
    local: Schema.Option(Schema.Boolean),
    selected: Schema.Option(Schema.Boolean),
  },
  ({ selected, local, hidden }) =>
    Effect.sync(() => {
      const entry = { ...calendar("primary", selected), hidden };

      const choices = Option.isSome(local)
        ? { [calendarKey("work", "primary")]: local.value }
        : {};

      expect(calendarVisible(entry, choices, current)).toBe(
        Option.getOrElse(local, () => Option.getOrElse(selected, () => false))
      );
    })
);

const LegacyRow = Schema.Struct({
  id: Schema.NonEmptyString,
  selected: Schema.Option(Schema.Boolean),
  wasHidden: Schema.Boolean,
});

it.effect.prop(
  "legacy migration keeps the visible set identical and stores shown exceptions only where the provider default differs",
  { rows: Schema.Array(LegacyRow).check(Schema.isMaxLength(20)) },
  ({ rows }) =>
    Effect.sync(() => {
      const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
      const entries = unique.map((row) => calendar(row.id, row.selected));

      const hidden = new Set(
        unique.flatMap((row) =>
          row.wasHidden ? [calendarKey("work", row.id)] : []
        )
      );

      const choices = Object.fromEntries(
        [...hidden].map((key) => [key, false])
      );

      const migrated = migrateVisibility(
        {
          accounts: [
            {
              accountId: "work",
              calendars: entries,
              colors: { calendar: {}, event: {} },
            },
          ],
        },
        choices,
        VisibilityMigration.cases.Legacy.make({}),
        ["work"]
      );

      expect(VisibilityMigration.guards.Current(migrated.migration)).toBe(true);

      for (const entry of entries) {
        const key = calendarKey(entry.accountId, entry.calendarId);
        expect(
          calendarVisible(entry, migrated.visibility, migrated.migration)
        ).toBe(!hidden.has(key));

        if (migrated.visibility[key] === true) {
          expect(entry.selected).not.toBe(true);
          expect(hidden.has(key)).toBe(false);
        }
      }

      const fresh = {
        ...calendar("primary", Option.some(false)),
        accountId: "brand-new-account",
      };

      expect(
        calendarVisible(fresh, migrated.visibility, migrated.migration)
      ).toBe(false);
    })
);

it.effect(
  "a revoked account retains its pending legacy migration until its own inventory succeeds",
  () =>
    Effect.sync(() => {
      const work = calendar("primary", Option.some(false));

      const partial = migrateVisibility(
        {
          accounts: [
            {
              accountId: "work",
              calendars: [work],
              colors: { calendar: {}, event: {} },
            },
          ],
        },
        {},
        VisibilityMigration.cases.Legacy.make({}),
        ["work", "personal"]
      );

      expect(partial.migration).toEqual(
        VisibilityMigration.cases.Accounts.make({ ids: ["personal"] })
      );
      const recovered = { ...work, accountId: "personal" };
      expect(
        calendarVisible(recovered, partial.visibility, partial.migration)
      ).toBe(true);

      const done = migrateVisibility(
        {
          accounts: [
            {
              accountId: "personal",
              calendars: [recovered],
              colors: { calendar: {}, event: {} },
            },
          ],
        },
        partial.visibility,
        partial.migration,
        ["work", "personal"]
      );

      expect(calendarVisible(recovered, done.visibility, done.migration)).toBe(
        true
      );
      expect(VisibilityMigration.guards.Current(done.migration)).toBe(true);

      const chosen = chooseVisibility(
        [work, recovered],
        done.visibility,
        done.migration,
        work,
        false
      );

      expect(chosen.hidden).toContain(calendarKey("work", "primary"));
      expect(chosen.hidden).not.toContain(calendarKey("personal", "primary"));
    })
);

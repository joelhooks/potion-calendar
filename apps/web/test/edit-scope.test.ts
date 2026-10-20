import { EditScope } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import {
  ScopeEdit,
  noEmailOnlyFields,
  offeredScopes,
  scopeOffer,
} from "../src/layout/edit-scope.js";
import type {
  ChangedEventField,
  ScopeEditValue,
  ScopeValue,
} from "../src/layout/edit-scope.js";

const ordinary: ScopeEditValue = {
  bulk: false,
  calendarMoved: false,
  dayChanged: false,
  eventKind: "ordinary",
  eventTypeChanged: false,
  firstOccurrence: false,
  noEmailOnly: false,
  operation: "edit",
  owned: true,
  participantCancellation: false,
  recurring: true,
  repeatChange: "none",
};

type Restriction =
  | "birthday"
  | "calendarMove"
  | "creation"
  | "firstWithAll"
  | "noEmailOnly"
  | "notOwned"
  | "ordinaryDayChange"
  | "participantCancellation"
  | "repeatChange";

const table: readonly {
  readonly scope: ScopeValue;
  readonly excludedBy: readonly Restriction[];
}[] = [
  {
    excludedBy: ["repeatChange", "calendarMove", "creation", "birthday"],
    scope: "single",
  },
  {
    excludedBy: [
      "notOwned",
      "noEmailOnly",
      "calendarMove",
      "participantCancellation",
      "repeatChange",
      "creation",
      "firstWithAll",
    ],
    scope: "allFollowing",
  },
  { excludedBy: ["ordinaryDayChange"], scope: "all" },
];

const restrictions = (edit: ScopeEditValue): ReadonlySet<Restriction> => {
  const facts: readonly {
    readonly key: Restriction;
    readonly active: boolean;
  }[] = [
    { active: edit.eventKind === "birthday", key: "birthday" },
    { active: edit.calendarMoved, key: "calendarMove" },
    { active: edit.operation === "create", key: "creation" },
    {
      active:
        edit.firstOccurrence && (!edit.dayChanged || edit.eventKind === "hold"),
      key: "firstWithAll",
    },
    { active: edit.noEmailOnly, key: "noEmailOnly" },
    { active: !edit.owned, key: "notOwned" },
    {
      active: edit.dayChanged && edit.eventKind !== "hold",
      key: "ordinaryDayChange",
    },
    { active: edit.participantCancellation, key: "participantCancellation" },
    { active: edit.repeatChange !== "none", key: "repeatChange" },
  ];

  return new Set(facts.flatMap((fact) => (fact.active ? [fact.key] : [])));
};

it.effect(
  "only colour and reminder changes are no-email-only under the desk's policy",
  () =>
    Effect.sync(() => {
      expect(noEmailOnlyFields([])).toBe(true);
      expect(noEmailOnlyFields(["colorId", "reminders"])).toBe(true);

      const meetingFields: readonly ChangedEventField[] = [
        "title",
        "start",
        "end",
        "location",
        "description",
        "recurrence",
        "attendees",
        "calendar",
        "visibility",
        "transparency",
        "guestsCanInviteOthers",
        "guestsCanModify",
        "guestsCanSeeOtherGuests",
      ];

      for (const field of meetingFields) {
        expect(noEmailOnlyFields(["colorId", "reminders", field])).toBe(false);
      }
    })
);

it.effect.prop(
  "scope availability matches the independent E22 exclusion table",
  { edit: ScopeEdit },
  ({ edit }) =>
    Effect.sync(() => {
      const excluded = restrictions(edit);

      const expected = edit.recurring
        ? table.flatMap((row) =>
            row.excludedBy.every((rule) => !excluded.has(rule))
              ? [row.scope]
              : []
          )
        : ["single"];

      expect(offeredScopes(edit)).toEqual(expected);
    }),
  { arbitrary: { runs: 1000 } }
);

it.effect.prop(
  "scope defaults never select an unavailable option and explicit skip paths never show the chooser",
  { edit: ScopeEdit, selected: Schema.Option(EditScope) },
  ({ edit, selected }) =>
    Effect.sync(() => {
      const previous = Option.getOrUndefined(selected);
      const offer = scopeOffer(edit, previous);
      expect(new Set(offer.choices).size).toBe(offer.choices.length);
      expect(offer.defaultScope).toBe(
        previous !== undefined && offer.choices.includes(previous)
          ? previous
          : offer.choices[0]
      );

      if (
        !edit.recurring ||
        edit.bulk ||
        edit.eventTypeChanged ||
        edit.repeatChange === "remove"
      ) {
        expect(offer.prompt).not.toBe("scope");
      }

      if (edit.recurring && edit.repeatChange === "remove") {
        expect(offer.prompt).toBe("removeRecurrence");
      }
    }),
  { arbitrary: { runs: 1000 } }
);

it.effect(
  "first occurrences suppress following only when All events remains available",
  () =>
    Effect.sync(() => {
      expect(offeredScopes({ ...ordinary, firstOccurrence: true })).toEqual([
        "single",
        "all",
      ]);
      expect(
        offeredScopes({ ...ordinary, dayChanged: true, firstOccurrence: true })
      ).toEqual(["single", "allFollowing"]);
      expect(
        offeredScopes({
          ...ordinary,
          dayChanged: true,
          eventKind: "hold",
          firstOccurrence: true,
        })
      ).toEqual(["single", "all"]);
    })
);

it.effect(
  "repeat and calendar changes cannot silently fall back to a single occurrence",
  () =>
    Effect.sync(() => {
      expect(scopeOffer({ ...ordinary, repeatChange: "pattern" })).toEqual({
        choices: ["all"],
        defaultScope: "all",
        prompt: "scope",
      });
      expect(scopeOffer({ ...ordinary, calendarMoved: true })).toEqual({
        choices: ["all"],
        defaultScope: "all",
        prompt: "scope",
      });
      expect(
        scopeOffer({ ...ordinary, dayChanged: true, repeatChange: "pattern" })
      ).toEqual({
        choices: [],
        defaultScope: undefined,
        prompt: "unavailable",
      });
      expect(scopeOffer({ ...ordinary, repeatChange: "remove" }).prompt).toBe(
        "removeRecurrence"
      );
    })
);

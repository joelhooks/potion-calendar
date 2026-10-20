import type { EditScope, EventFieldsValue } from "@calendar/calendar/contracts";
import { Schema } from "effect";

export const ScopeEdit = Schema.Struct({
  bulk: Schema.Boolean,
  calendarMoved: Schema.Boolean,
  dayChanged: Schema.Boolean,
  eventKind: Schema.Literals(["ordinary", "birthday", "hold"]),
  eventTypeChanged: Schema.Boolean,
  firstOccurrence: Schema.Boolean,
  noEmailOnly: Schema.Boolean,
  operation: Schema.Literals(["create", "edit", "delete"]),
  owned: Schema.Boolean,
  participantCancellation: Schema.Boolean,
  recurring: Schema.Boolean,
  repeatChange: Schema.Literals(["none", "pattern", "remove"]),
});

export type ScopeEditValue = typeof ScopeEdit.Type;

export type ScopeValue = typeof EditScope.Type;

export type ChangedEventField = keyof EventFieldsValue | "calendar";

export const noEmailOnlyFields = (
  fields: readonly ChangedEventField[]
): boolean =>
  fields.every((field) => field === "colorId" || field === "reminders");

export interface ScopeOffer {
  readonly choices: readonly ScopeValue[];
  readonly defaultScope: ScopeValue | undefined;
  readonly prompt: "none" | "scope" | "removeRecurrence" | "unavailable";
}

export const offeredScopes = (edit: ScopeEditValue): readonly ScopeValue[] => {
  if (!edit.recurring) {
    return ["single"];
  }

  const choices: ScopeValue[] = [];
  const creating = edit.operation === "create";
  const unchangedRepeat = edit.repeatChange === "none";
  const all = !edit.dayChanged || edit.eventKind === "hold";

  if (
    unchangedRepeat &&
    !edit.calendarMoved &&
    !creating &&
    edit.eventKind !== "birthday"
  ) {
    choices.push("single");
  }

  if (
    edit.owned &&
    !edit.noEmailOnly &&
    !edit.calendarMoved &&
    !edit.participantCancellation &&
    unchangedRepeat &&
    !creating &&
    !(edit.firstOccurrence && all)
  ) {
    choices.push("allFollowing");
  }

  if (all) {
    choices.push("all");
  }

  return choices;
};

export const scopeOffer = (
  edit: ScopeEditValue,
  selected?: ScopeValue
): ScopeOffer => {
  const choices = offeredScopes(edit);

  const defaultScope =
    selected !== undefined && choices.includes(selected)
      ? selected
      : choices[0];

  if (!edit.recurring) {
    return { choices, defaultScope, prompt: "none" };
  }

  if (edit.repeatChange === "remove") {
    return { choices, defaultScope, prompt: "removeRecurrence" };
  }

  if (edit.bulk || edit.eventTypeChanged) {
    return { choices, defaultScope, prompt: "none" };
  }

  return {
    choices,
    defaultScope,
    prompt: choices.length === 0 ? "unavailable" : "scope",
  };
};

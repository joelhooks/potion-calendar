import { AgendaKey } from "@calendar/core/desktop-bridge";
import type {
  AgendaEventValue,
  AgendaKeyValue,
  AgendaSnapshotValue,
  DesktopPreferencesValue,
} from "@calendar/core/desktop-bridge";
import { Schema } from "effect";

export class PromptAdmissionSuperseded extends Schema.TaggedError<PromptAdmissionSuperseded>()(
  "PromptAdmissionSuperseded",
  { message: Schema.String }
) {}

export const PromptAdmissionAuthority = Schema.Struct({
  lease: Schema.String,
  personId: Schema.NullOr(Schema.String),
  revision: Schema.Finite,
});

export const PromptAdmissionPermit = Schema.Struct({
  active: Schema.Boolean,
  main: Schema.optionalKey(PromptAdmissionAuthority),
});

export interface PromptAdmissionPermitValue {
  active: boolean;
  readonly main?: typeof PromptAdmissionAuthority.Type;
}

export const PromptInputAcknowledgement = Schema.Struct({
  attempt: Schema.NullOr(Schema.String),
  authority: Schema.NullOr(
    Schema.Struct({
      lease: Schema.String,
      personId: Schema.NullOr(Schema.String),
      revision: Schema.Finite,
    })
  ),
  claims: Schema.Array(Schema.Struct({ key: AgendaKey, start: Schema.Finite })),
});

const minuteMilliseconds = 60_000;

export const promptIdentity = (key: AgendaKeyValue): string =>
  JSON.stringify([key.accountId, key.calendarId, key.eventId]);

export const promptBatchIdentity = (
  events: readonly AgendaEventValue[]
): string =>
  JSON.stringify(
    events
      .map((event) => JSON.stringify([promptIdentity(event.key), event.start]))
      .toSorted()
  );

export interface PromptContext {
  readonly now: number;
  readonly pending: readonly AgendaEventValue[];
  readonly preferences: DesktopPreferencesValue;
  readonly remembered: ReadonlyMap<string, number>;
  readonly snapshot: AgendaSnapshotValue;
  readonly snoozed: ReadonlyMap<
    string,
    { readonly start: number; readonly until: number }
  >;
  readonly visible: readonly AgendaEventValue[];
  readonly visibleOwner: Pick<
    typeof PromptAdmissionAuthority.Type,
    "lease" | "personId"
  > | null;
}

export type PromptInput = Pick<
  PromptContext,
  "now" | "preferences" | "snapshot"
>;

export const initialPrompt = (input: PromptInput): PromptContext => ({
  ...input,
  pending: [],
  remembered: new Map(),
  snoozed: new Map(),
  visible: [],
  visibleOwner: null,
});

const eligibleMeeting = (
  event: AgendaEventValue,
  preferences: DesktopPreferencesValue
): boolean =>
  preferences.menuBar &&
  preferences.promptMinutes !== null &&
  !event.allDay &&
  event.hasParticipants &&
  event.conferenceUrl !== null &&
  event.responseStatus !== "declined";

const expired = (event: AgendaEventValue, now: number): boolean =>
  Math.floor((now - event.start) / minuteMilliseconds) > 15;

const due = (
  event: AgendaEventValue,
  preferences: DesktopPreferencesValue,
  now: number
): boolean => {
  if (preferences.promptMinutes === null) {
    return false;
  }

  const currentMinute = Math.floor(now / minuteMilliseconds);
  const startMinute = Math.floor(event.start / minuteMilliseconds);

  return (
    currentMinute <= startMinute &&
    currentMinute >= startMinute - preferences.promptMinutes
  );
};

const reconcileSnoozes = (
  context: PromptContext,
  byId: ReadonlyMap<string, AgendaEventValue>
) => {
  const pending = new Map<string, AgendaEventValue>();
  const snoozed = new Map(context.snoozed);

  for (const [identity, snooze] of snoozed) {
    const current = byId.get(identity);

    if (current !== undefined && current.start !== snooze.start) {
      snoozed.delete(identity);
    } else if (context.now >= snooze.until) {
      snoozed.delete(identity);

      if (
        current !== undefined &&
        eligibleMeeting(current, context.preferences) &&
        !expired(current, context.now)
      ) {
        pending.set(identity, current);
      }
    }
  }

  return { pending, snoozed };
};

export const reconcilePrompts = (
  context: PromptContext,
  input: Partial<PromptInput>,
  retained: readonly AgendaEventValue[] = context.visible
): PromptContext => {
  const next = { ...context, ...input };
  const remembered = new Map(context.remembered);

  const byId = new Map(
    next.snapshot.events.map((event) => [promptIdentity(event.key), event])
  );

  for (const event of byId.values()) {
    const start = remembered.get(promptIdentity(event.key));

    if (start !== undefined && start !== event.start) {
      remembered.delete(promptIdentity(event.key));
    }
  }

  const { pending, snoozed } = reconcileSnoozes(next, byId);

  for (const previous of retained) {
    const current = byId.get(promptIdentity(previous.key));

    if (
      current !== undefined &&
      current.start === previous.start &&
      !snoozed.has(promptIdentity(current.key)) &&
      eligibleMeeting(current, next.preferences) &&
      !expired(current, next.now)
    ) {
      pending.set(promptIdentity(current.key), current);
    }
  }

  for (const event of byId.values()) {
    if (
      !remembered.has(promptIdentity(event.key)) &&
      !snoozed.has(promptIdentity(event.key)) &&
      eligibleMeeting(event, next.preferences) &&
      due(event, next.preferences, next.now)
    ) {
      pending.set(promptIdentity(event.key), event);
    }
  }

  return { ...next, pending: [...pending.values()], remembered, snoozed };
};

export const presentedPrompts = (context: PromptContext): PromptContext => {
  const remembered = new Map(context.remembered);

  for (const event of context.pending) {
    remembered.set(promptIdentity(event.key), event.start);
  }

  return { ...context, remembered, visible: context.pending };
};

export const snoozePrompt = (
  context: PromptContext,
  key: AgendaKeyValue,
  now: number,
  retained: readonly AgendaEventValue[] = context.visible
): PromptContext => {
  const identity = promptIdentity(key);

  const event = [...context.pending, ...context.visible].find(
    (card) => promptIdentity(card.key) === identity
  );

  if (event === undefined) {
    return context;
  }

  const remembered = new Map(context.remembered);
  remembered.delete(identity);

  const snoozed = new Map([
    ...context.snoozed,
    [identity, { start: event.start, until: now + minuteMilliseconds }],
  ]);

  return reconcilePrompts(
    {
      ...context,
      now,
      remembered,
      snoozed,
      visible: context.visible.filter(
        (card) => promptIdentity(card.key) !== identity
      ),
    },
    {},
    retained.filter((card) => promptIdentity(card.key) !== identity)
  );
};

export const dismissPrompt = (
  context: PromptContext,
  key: AgendaKeyValue,
  retained: readonly AgendaEventValue[] = context.visible
): PromptContext => {
  const remembered = new Map(context.remembered);

  const event = context.snapshot.events.find(
    (candidate) => promptIdentity(candidate.key) === promptIdentity(key)
  );

  if (event !== undefined) {
    remembered.set(promptIdentity(key), event.start);
  }

  const snoozed = new Map(context.snoozed);
  snoozed.delete(promptIdentity(key));

  return reconcilePrompts(
    {
      ...context,
      remembered,
      snoozed,
      visible: context.visible.filter(
        (card) => promptIdentity(card.key) !== promptIdentity(key)
      ),
    },
    {},
    retained.filter((card) => promptIdentity(card.key) !== promptIdentity(key))
  );
};

export const dismissAllPrompts = (context: PromptContext): PromptContext => {
  const remembered = new Map(context.remembered);

  for (const event of [...context.visible, ...context.pending]) {
    remembered.set(promptIdentity(event.key), event.start);
  }

  return {
    ...context,
    pending: [],
    remembered,
    visible: [],
    visibleOwner: null,
  };
};

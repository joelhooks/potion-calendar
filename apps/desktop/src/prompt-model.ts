import type {
  AgendaEventValue,
  AgendaKeyValue,
  AgendaSnapshotValue,
  DesktopPreferencesValue,
} from "@calendar/core/desktop-bridge";

const minuteMilliseconds = 60_000;

export const promptIdentity = (key: AgendaKeyValue): string =>
  JSON.stringify([key.accountId, key.calendarId, key.eventId]);

export interface PromptContext {
  readonly now: number;
  readonly pending: readonly AgendaEventValue[];
  readonly preferences: DesktopPreferencesValue;
  readonly remembered: ReadonlyMap<string, number>;
  readonly snapshot: AgendaSnapshotValue;
  readonly visible: readonly AgendaEventValue[];
}

export type PromptInput = Pick<
  PromptContext,
  "now" | "preferences" | "snapshot"
>;

export const initialPrompt = (input: PromptInput): PromptContext => ({
  ...input,
  pending: [],
  remembered: new Map(),
  visible: [],
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

export const reconcilePrompts = (
  context: PromptContext,
  input: Partial<PromptInput>
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

  const pending = new Map<string, AgendaEventValue>();

  for (const previous of context.visible) {
    const current = byId.get(promptIdentity(previous.key));

    if (
      current !== undefined &&
      current.start === previous.start &&
      eligibleMeeting(current, next.preferences) &&
      !expired(current, next.now)
    ) {
      pending.set(promptIdentity(current.key), current);
    }
  }

  for (const event of byId.values()) {
    if (
      !remembered.has(promptIdentity(event.key)) &&
      eligibleMeeting(event, next.preferences) &&
      due(event, next.preferences, next.now)
    ) {
      pending.set(promptIdentity(event.key), event);
    }
  }

  return { ...next, pending: [...pending.values()], remembered };
};

export const presentedPrompts = (context: PromptContext): PromptContext => {
  const remembered = new Map(context.remembered);

  for (const event of context.pending) {
    remembered.set(promptIdentity(event.key), event.start);
  }

  return { ...context, remembered, visible: context.pending };
};

export const dismissPrompt = (
  context: PromptContext,
  key: AgendaKeyValue
): PromptContext => {
  const remembered = new Map(context.remembered);

  const event = context.snapshot.events.find(
    (candidate) => promptIdentity(candidate.key) === promptIdentity(key)
  );

  if (event !== undefined) {
    remembered.set(promptIdentity(key), event.start);
  }

  return reconcilePrompts(
    {
      ...context,
      remembered,
      visible: context.visible.filter(
        (card) => promptIdentity(card.key) !== promptIdentity(key)
      ),
    },
    {}
  );
};

export const dismissAllPrompts = (context: PromptContext): PromptContext => {
  const remembered = new Map(context.remembered);

  for (const event of [...context.visible, ...context.pending]) {
    remembered.set(promptIdentity(event.key), event.start);
  }

  return { ...context, pending: [], remembered, visible: [] };
};

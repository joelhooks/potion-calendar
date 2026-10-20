import type {
  AgendaEventValue,
  AgendaSnapshotValue,
  DesktopPreferencesValue,
} from "@calendar/core/desktop-bridge";

const minuteMilliseconds = 60_000;

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
    next.snapshot.events.map((event) => [event.key.eventId, event])
  );

  for (const event of byId.values()) {
    const start = remembered.get(event.key.eventId);

    if (start !== undefined && start !== event.start) {
      remembered.delete(event.key.eventId);
    }
  }

  const pending = new Map<string, AgendaEventValue>();

  for (const previous of context.visible) {
    const current = byId.get(previous.key.eventId);

    if (
      current !== undefined &&
      current.start === previous.start &&
      eligibleMeeting(current, next.preferences) &&
      !expired(current, next.now)
    ) {
      pending.set(current.key.eventId, current);
    }
  }

  for (const event of byId.values()) {
    if (
      !remembered.has(event.key.eventId) &&
      eligibleMeeting(event, next.preferences) &&
      due(event, next.preferences, next.now)
    ) {
      pending.set(event.key.eventId, event);
    }
  }

  return { ...next, pending: [...pending.values()], remembered };
};

export const presentedPrompts = (context: PromptContext): PromptContext => {
  const remembered = new Map(context.remembered);

  for (const event of context.pending) {
    remembered.set(event.key.eventId, event.start);
  }

  return { ...context, remembered, visible: context.pending };
};

export const dismissPrompt = (
  context: PromptContext,
  eventId: string
): PromptContext => {
  const remembered = new Map(context.remembered);

  const event = context.snapshot.events.find(
    (candidate) => candidate.key.eventId === eventId
  );

  if (event !== undefined) {
    remembered.set(eventId, event.start);
  }

  return reconcilePrompts(
    {
      ...context,
      remembered,
      visible: context.visible.filter((card) => card.key.eventId !== eventId),
    },
    {}
  );
};

export const dismissAllPrompts = (context: PromptContext): PromptContext => {
  const remembered = new Map(context.remembered);

  for (const event of [...context.visible, ...context.pending]) {
    remembered.set(event.key.eventId, event.start);
  }

  return { ...context, pending: [], remembered, visible: [] };
};

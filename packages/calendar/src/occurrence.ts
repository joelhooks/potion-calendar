import { watchActor } from "@calendar/capability/actor-watch";
import {
  createEffectActor,
  createEffectLogic,
  join,
  setupEffect,
} from "@xstate/effect";
import { DateTime, Effect, Option, Schema } from "effect";
import { types } from "xstate";

import { calendarActorFailure } from "./calendar-actor-failure.js";
import { Provider } from "./errors.js";
import type { CalendarFailureValue } from "./errors.js";
import { GoogleCalendarClient } from "./google.js";
import type { ListedEvents } from "./google.js";
import { CalendarEvent } from "./model.js";
import type { CalendarEventValue, EventTimeValue } from "./model.js";
import { ReadNeighborOccurrenceInput } from "./occurrence-model.js";
import type { ReadNeighborOccurrenceInputValue } from "./occurrence-model.js";
import { CalendarReadBudget } from "./sync.js";

interface RankedOccurrence {
  readonly event: CalendarEventValue;
  readonly start: number;
  readonly original: number;
}

interface OccurrenceContext {
  readonly request: ReadNeighborOccurrenceInputValue;
  readonly selected: Option.Option<CalendarEventValue>;
  readonly best: RankedOccurrence | undefined;
  readonly pageToken: string | undefined;
  readonly seen: readonly string[];
  readonly pages: number;
  readonly maxPages: number;
  readonly lastStart: number;
  readonly outcome:
    | { readonly event: CalendarEventValue | null }
    | { readonly error: CalendarFailureValue }
    | undefined;
}

const timeMillis = (time: EventTimeValue | undefined): Option.Option<number> =>
  time === undefined
    ? Option.none()
    : DateTime.make(
        "date" in time ? `${time.date}T00:00:00Z` : time.dateTime
      ).pipe(Option.map(DateTime.toEpochMillis));

export const rankOccurrence = (
  event: CalendarEventValue
): RankedOccurrence | undefined => {
  const start = timeMillis(event.start);
  const original = timeMillis(event.originalStartTime);

  return Option.isSome(start) && Option.isSome(original)
    ? { event, original: original.value, start: start.value }
    : undefined;
};

export const compareOccurrences = (
  left: RankedOccurrence,
  right: RankedOccurrence
): number => {
  const start = left.start - right.start;

  if (start !== 0) {
    return start;
  }

  const original = left.original - right.original;

  if (original !== 0) {
    return original;
  }

  if (left.event.eventId === right.event.eventId) {
    return 0;
  }

  return left.event.eventId < right.event.eventId ? -1 : 1;
};

const failure = (direction: ReadNeighborOccurrenceInputValue["direction"]) =>
  new Provider({
    message: `Couldn't find the ${direction} occurrence`,
    operation: "readNeighborOccurrence",
    status: 200,
  });

const failed = (context: OccurrenceContext) => ({
  context: { outcome: { error: failure(context.request.direction) } },
  target: "failed",
});

const finished = (context: OccurrenceContext) => ({
  context: { outcome: { event: context.best?.event ?? null } },
  target: context.best === undefined ? "none" : "found",
});

const PageInput = Schema.Struct({
  pageToken: Schema.optional(Schema.String),
  request: ReadNeighborOccurrenceInput,
  selected: Schema.Option(CalendarEvent),
});

const readAnchor = createEffectLogic({
  effect: ({ input }) =>
    GoogleCalendarClient.use((google) => google.get(input)),
  schemas: { input: ReadNeighborOccurrenceInput },
});

const readPage = createEffectLogic({
  effect: ({ input }) =>
    Effect.gen(function* readOccurrencePage() {
      const selected = Option.getOrUndefined(input.selected);

      const anchor =
        selected === undefined ? undefined : rankOccurrence(selected);

      if (
        selected === undefined ||
        anchor === undefined ||
        selected.recurringEventId === undefined ||
        selected.iCalUID === undefined
      ) {
        return yield* failure(input.request.direction);
      }

      const google = yield* GoogleCalendarClient;

      return yield* input.request.direction === "next"
        ? google.listPage({
            iCalUID: selected.iCalUID,
            orderBy: "startTime",
            pageToken: input.pageToken,
            ref: input.request,
            singleEvents: true,
            timeMin: DateTime.formatIso(DateTime.makeUnsafe(anchor.start - 1)),
          })
        : google.instancesPage(
            { ...input.request, eventId: selected.recurringEventId },
            input.pageToken,
            {
              timeMax: DateTime.formatIso(
                DateTime.makeUnsafe(anchor.start + 1)
              ),
            }
          );
    }),
  schemas: { input: PageInput },
});

const sameSeries = (event: CalendarEventValue, selected: CalendarEventValue) =>
  event.accountId === selected.accountId &&
  event.calendarId === selected.calendarId &&
  event.recurringEventId === selected.recurringEventId &&
  event.iCalUID === selected.iCalUID &&
  event.eventId !== selected.eventId;

const chooseNearer = (
  context: OccurrenceContext,
  anchor: RankedOccurrence,
  ranked: RankedOccurrence,
  best: RankedOccurrence | undefined
) => {
  const order = compareOccurrences(ranked, anchor);
  const eligible = context.request.direction === "next" ? order > 0 : order < 0;

  const nearer =
    best === undefined ||
    (context.request.direction === "next"
      ? compareOccurrences(ranked, best) < 0
      : compareOccurrences(ranked, best) > 0);

  return eligible && nearer ? ranked : best;
};

const nextPrefixComplete = (
  context: OccurrenceContext,
  best: RankedOccurrence | undefined,
  lastStart: number
) =>
  context.request.direction === "next" &&
  best !== undefined &&
  lastStart > best.start;

const completeOccurrenceIdentity = (event: CalendarEventValue): boolean =>
  event.recurringEventId !== undefined &&
  event.recurringEventId !== "" &&
  event.iCalUID !== undefined &&
  event.iCalUID !== "";

const choosePage = (context: OccurrenceContext, page: ListedEvents) => {
  const selected = Option.getOrUndefined(context.selected);
  const anchor = selected === undefined ? undefined : rankOccurrence(selected);

  if (selected === undefined || anchor === undefined) {
    return failed(context);
  }

  let { best, lastStart } = context;

  for (const event of page.events) {
    if (event.status === "cancelled") {
      continue;
    }

    if (!completeOccurrenceIdentity(event)) {
      return failed(context);
    }

    const start = Option.getOrUndefined(timeMillis(event.start));

    if (
      start === undefined ||
      (context.request.direction === "next" && start < lastStart)
    ) {
      return failed(context);
    }

    lastStart = start;

    if (!sameSeries(event, selected)) {
      continue;
    }

    const ranked = rankOccurrence(event);

    if (ranked === undefined) {
      return failed(context);
    }

    best = chooseNearer(context, anchor, ranked, best);
  }

  if (
    page.nextPageToken !== undefined &&
    (page.nextPageToken === "" || context.seen.includes(page.nextPageToken))
  ) {
    return failed(context);
  }

  const next = { ...context, best, lastStart, pages: context.pages + 1 };

  if (
    page.nextPageToken === undefined ||
    nextPrefixComplete(context, best, lastStart)
  ) {
    return {
      ...finished(next),
      context: {
        best,
        lastStart,
        outcome: { event: best?.event ?? null },
        pages: next.pages,
      },
    };
  }

  return {
    context: {
      best,
      lastStart,
      pageToken: page.nextPageToken,
      pages: next.pages,
      seen: [...context.seen, page.nextPageToken],
    },
    target: "checkingBudget",
  };
};

export const occurrenceMachine = setupEffect({
  actors: { readAnchor, readPage },
  schemas: {
    context: types<OccurrenceContext>(),
    input: Schema.Struct({
      maxPages: Schema.Int,
      request: ReadNeighborOccurrenceInput,
    }),
  },
}).createMachine({
  context: ({ input }) => ({
    best: undefined,
    lastStart: Number.NEGATIVE_INFINITY,
    maxPages: input.maxPages,
    outcome: undefined,
    pageToken: undefined,
    pages: 0,
    request: input.request,
    seen: [],
    selected: Option.none(),
  }),
  initial: "readingAnchor",
  output: ({ context }) => context.outcome,
  states: {
    checkingBudget: {
      always: ({ context }) =>
        context.pages >= context.maxPages
          ? failed(context)
          : { target: "readingPage" },
    },
    failed: { type: "final" },
    found: { type: "final" },
    none: { type: "final" },
    readingAnchor: {
      invoke: {
        input: ({ context }) => context.request,
        onDone: ({ context, event }) => {
          const selected = event.output;

          if (
            selected.accountId !== context.request.accountId ||
            selected.calendarId !== context.request.calendarId ||
            selected.eventId !== context.request.eventId ||
            selected.status === "cancelled" ||
            selected.recurringEventId === undefined ||
            selected.recurringEventId === "" ||
            selected.iCalUID === undefined ||
            selected.iCalUID === "" ||
            rankOccurrence(selected) === undefined
          ) {
            return failed(context);
          }

          return {
            context: { selected: Option.some(selected) },
            target: "checkingBudget",
          };
        },
        onError: {
          context: ({ event }) => ({ outcome: { error: event.error } }),
          target: "failed",
        },
        src: "readAnchor",
      },
    },
    readingPage: {
      invoke: {
        input: ({ context }) => ({
          pageToken: context.pageToken,
          request: context.request,
          selected: context.selected,
        }),
        onDone: ({ context, event }) => choosePage(context, event.output),
        onError: {
          context: ({ event }) => ({ outcome: { error: event.error } }),
          target: "failed",
        },
        src: "readPage",
      },
    },
  },
});

export const readNeighbor = Effect.fn("readNeighbor")(function* readNeighbor(
  request: ReadNeighborOccurrenceInputValue
) {
  const budget = yield* CalendarReadBudget;

  const actor = yield* createEffectActor(occurrenceMachine, {
    input: { maxPages: budget.maxPages, request },
  });

  yield* watchActor("occurrenceNavigation", actor);
  // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Expected provider failures travel in the outcome; machine crashes remain defects.
  const outcome = yield* join(actor).pipe(Effect.orDie);

  if (outcome === undefined) {
    return yield* Effect.die(
      new Error("Occurrence navigation finished without an outcome")
    );
  }

  if ("error" in outcome) {
    return yield* calendarActorFailure(outcome.error);
  }

  return outcome.event;
}, Effect.scoped);

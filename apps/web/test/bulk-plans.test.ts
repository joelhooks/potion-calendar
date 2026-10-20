import type { CreateEventInput } from "@calendar/calendar/contracts";
import { CalendarEvent } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Option, Schema, Stream } from "effect";

import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import {
  DeleteCommand,
  DeletionSession,
} from "../src/client/editing/deletion-session.js";
import { LoadedEditor } from "../src/client/editing/editor-session-model.js";
import { prepareEditor } from "../src/client/editing/prepare-editor.js";
import { writeEditor } from "../src/client/editing/write-editor.js";
import {
  BulkPermission,
  BulkReceipt,
  BulkUndo,
  bindBulkWrite,
  planBulk,
  summarizeBulk,
} from "../src/layout/bulk-plans.js";
import type { BulkOpening } from "../src/layout/bulk-plans.js";
import { eventDraft, initialRepeat } from "../src/layout/editor-draft.js";
import { dayFromIso, initialNavigation } from "../src/layout/navigation.js";
import { editorCalendars, editorOriginal } from "./editor-fixture.js";

const opening: BulkOpening = {
  calendars: editorCalendars,
  navigation: initialNavigation(dayFromIso("2026-10-19")),
  primaryZone: "America/Los_Angeles",
  selection: Option.none(),
};

const Item = Schema.Struct({
  allDay: Schema.Boolean,
  allowed: Schema.Boolean,
  day: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(25)
  ),
  minute: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(1439)
  ),
  recurring: Schema.Boolean,
  seconds: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(59)
  ),
});

const source = (item: typeof Item.Type, index: number) => {
  const start = DateTime.add(DateTime.makeUnsafe("2026-10-01T00:00:00Z"), {
    days: item.day - 1,
    minutes: item.minute,
    seconds: item.seconds,
  });

  const end = DateTime.add(start, { hours: 1 });

  return CalendarEvent.make({
    accountId: "work",
    calendarId: "primary",
    end: item.allDay
      ? { date: DateTime.formatIsoDateUtc(DateTime.add(start, { days: 2 })) }
      : { dateTime: DateTime.formatIso(end), timeZone: "UTC" },
    eventId: `instance-${index}`,
    organizer: { self: true },
    recurringEventId: item.recurring ? `series-${index}` : undefined,
    start: item.allDay
      ? { date: DateTime.formatIsoDateUtc(start) }
      : { dateTime: DateTime.formatIso(start), timeZone: "UTC" },
    status: "confirmed",
    title: `Event ${index}`,
  });
};

const prepare = Effect.fn("prepareBulkFixture")(function* prepare(
  step: ReturnType<typeof planBulk>["steps"][number]
) {
  const { event } = step.request;
  const initial = yield* eventDraft(event, undefined, opening.primaryZone);

  const draft =
    step.request.mode === "duplicate"
      ? { ...initial, repeat: yield* initialRepeat(initial.startDate) }
      : initial;

  const session = LoadedEditor.make({
    baseline: draft,
    calendars: editorCalendars,
    createId:
      step.request.mode === "duplicate"
        ? Option.some("0123456789abcdef")
        : Option.none(),
    draft,
    id: step.key,
    kind: step.request.mode === "duplicate" ? "duplicate" : "edit",
    master: Option.none(),
    moveSupport: "notAvailable",
    navigation: opening.navigation,
    operation: step.request.mode === "delete" ? "delete" : "save",
    original: Option.some(event),
    selection: Option.some(step.key),
  });

  return yield* prepareEditor(session);
});

it.effect.prop(
  "bulk duplicates preserve every selected endpoint and relative arrangement while permission skips never produce a request",
  {
    emailNeeded: Schema.Boolean,
    items: Schema.Array(Item).check(Schema.isMaxLength(10)),
    sendUpdates: Schema.Literals(["none", "all"]),
  },
  ({ emailNeeded, items, sendUpdates }) =>
    Effect.gen(function* duplicateArrangement() {
      const candidates = items.map((item, index) => ({
        event: source(item, index),
        key: `key-${index}`,
        permission: item.allowed
          ? BulkPermission.cases.Allowed.make({})
          : BulkPermission.cases.Blocked.make({
              reason: "Google refused this destination.",
            }),
      }));

      const selection = candidates.map(({ key }) => key);
      const before = structuredClone(candidates);
      const plan = planBulk("duplicate", selection, candidates, opening);

      const accepted = candidates.filter((candidate) =>
        BulkPermission.guards.Allowed(candidate.permission)
      );

      expect(plan.steps.map(({ key }) => key)).toEqual(
        accepted.map(({ key }) => key)
      );
      expect(plan.skipped).toHaveLength(items.length - accepted.length);

      const copies = [];

      for (const step of plan.steps) {
        const prepared = yield* prepare(step);

        const bound = yield* bindBulkWrite(step, {
          ...prepared,
          emailNeeded,
          sendUpdates,
        });

        expect(step.request.mode).toBe("duplicate");
        expect(bound.scope).toBe("single");
        expect(bound.choices).toEqual(["single"]);
        expect(bound.prompt).toBe("none");
        expect(bound.fields.start).toEqual(step.request.event.start);
        expect(bound.fields.end).toEqual(step.request.event.end);
        expect(bound.fields.recurrence).toEqual([]);
        expect(bound.emailNeeded).toBe(false);
        expect(bound.sendUpdates).toBe("none");
        copies.push(bound.fields);
      }

      for (let index = 1; index < accepted.length; index += 1) {
        const previous = accepted[index - 1]?.event.start;
        const current = accepted[index]?.event.start;
        const copyPrevious = copies[index - 1]?.start;
        const copyCurrent = copies[index]?.start;

        if (
          previous !== undefined &&
          current !== undefined &&
          copyPrevious !== undefined &&
          copyCurrent !== undefined
        ) {
          const time = (value: typeof previous) =>
            DateTime.toEpochMillis(
              DateTime.makeUnsafe("date" in value ? value.date : value.dateTime)
            );

          expect(time(copyCurrent) - time(copyPrevious)).toBe(
            time(current) - time(previous)
          );
        }
      }

      expect(candidates).toEqual(before);
    })
);

it.effect.prop(
  "bulk deletion pins each selected occurrence to single scope and skips denied events with their reason",
  {
    emailNeeded: Schema.Boolean,
    items: Schema.Array(Item).check(Schema.isMaxLength(10)),
    sendUpdates: Schema.Literals(["none", "all"]),
  },
  ({ emailNeeded, items, sendUpdates }) =>
    Effect.gen(function* deleteScope() {
      const candidates = items.map((item, index) => ({
        event: source(item, index),
        key: `key-${index}`,
        permission: item.allowed
          ? BulkPermission.cases.Allowed.make({})
          : BulkPermission.cases.Blocked.make({
              reason: "This calendar is read-only.",
            }),
      }));

      const plan = planBulk(
        "delete",
        candidates.map(({ key }) => key),
        candidates,
        opening
      );

      expect(plan.steps).toHaveLength(
        items.filter((item) => item.allowed).length
      );
      expect(
        plan.skipped.every(
          (issue) => issue.reason === "This calendar is read-only."
        )
      ).toBe(true);

      for (const step of plan.steps) {
        const prepared = yield* prepare(step);

        const bound = yield* bindBulkWrite(step, {
          ...prepared,
          emailNeeded,
          prompt: "scope",
          scope: "all",
          sendUpdates,
        });

        expect(step.request.mode).toBe("delete");
        expect(bound.scope).toBe("single");
        expect(bound.prompt).toBe("none");
        expect(bound.session.original).toEqual(Option.some(step.request.event));
        expect(bound.emailNeeded).toBe(false);
        expect(bound.sendUpdates).toBe("none");
      }
    })
);

it.effect.prop(
  "partial receipts preserve successes, expose failed titles/reasons and form one Undo group from available successes only",
  {
    operation: Schema.Literals(["delete", "duplicate"]),
    results: Schema.Array(
      Schema.Literals(["success", "unsupported", "failed", "pending"])
    ).check(Schema.isMaxLength(20)),
  },
  ({ operation, results }) =>
    Effect.sync(() => {
      const candidates = results.map((_, index) => ({
        event: {
          ...editorOriginal,
          eventId: `event-${index}`,
          title: `Title ${index}`,
        },
        key: `key-${index}`,
        permission: BulkPermission.cases.Allowed.make({}),
      }));

      const plan = planBulk(
        operation,
        candidates.map(({ key }) => key),
        candidates,
        opening
      );

      const receipts: (typeof BulkReceipt.Type)[] = [];

      for (const [index, result] of results.entries()) {
        const key = `key-${index}`;

        if (result === "failed") {
          receipts.push(
            BulkReceipt.cases.Failed.make({
              key,
              reason: `Google reason ${index}`,
            })
          );
        } else if (result !== "pending") {
          receipts.push(
            BulkReceipt.cases.Succeeded.make({
              key,
              undo:
                result === "success"
                  ? BulkUndo.cases.Available.make({
                      request: DeleteCommand.cases.Undo.make({
                        id: `undo-${index}`,
                      }),
                    })
                  : BulkUndo.cases.Unavailable.make({
                      reason: "The existing Undo window has closed.",
                    }),
            })
          );
        }
      }

      const summary = summarizeBulk(plan, receipts);

      const keysFor = (state: (typeof results)[number]) =>
        results.flatMap((result, index) =>
          result === state ? [`key-${index}`] : []
        );

      expect(summary.succeeded).toEqual(
        results.flatMap((result, index) =>
          result === "success" || result === "unsupported"
            ? [`key-${index}`]
            : []
        )
      );
      expect(summary.pending).toEqual(keysFor("pending"));
      expect(summary.failed).toEqual(
        results.flatMap((result, index) =>
          result === "failed"
            ? [
                {
                  key: `key-${index}`,
                  reason: `Google reason ${index}`,
                  title: `Title ${index}`,
                },
              ]
            : []
        )
      );
      expect(summary.undo).toEqual(
        results.flatMap((result, index) =>
          operation === "delete" && result === "success"
            ? [DeleteCommand.cases.Undo.make({ id: `undo-${index}` })]
            : []
        )
      );
      expect(summary.undoUnavailable.map(({ key }) => key)).toEqual(
        operation === "delete"
          ? keysFor("unsupported")
          : results.flatMap((result, index) =>
              result === "success" || result === "unsupported"
                ? [`key-${index}`]
                : []
            )
      );
      expect(summary.skipped).toEqual([]);

      if (operation === "duplicate") {
        expect(
          summary.undoUnavailable.every(
            ({ reason }) =>
              reason === "The existing duplicate path does not support Undo."
          )
        ).toBe(true);
      }
    })
);

it.effect(
  "missing selections, denied events and duplicate source aliases are named skips; unrelated or conflicting receipts never become successes",
  () =>
    Effect.sync(() => {
      const candidates = [
        {
          event: editorOriginal,
          key: "first",
          permission: BulkPermission.cases.Allowed.make({}),
        },
        {
          event: editorOriginal,
          key: "alias",
          permission: BulkPermission.cases.Allowed.make({}),
        },
        {
          event: { ...editorOriginal, eventId: "blocked" },
          key: "blocked",
          permission: BulkPermission.cases.Blocked.make({
            reason: "No delete permission.",
          }),
        },
      ];

      const plan = planBulk(
        "delete",
        ["missing", "first", "alias", "blocked"],
        candidates,
        opening
      );

      const success = BulkReceipt.cases.Succeeded.make({
        key: "first",
        undo: BulkUndo.cases.Available.make({
          request: DeleteCommand.cases.Undo.make({ id: "undo" }),
        }),
      });

      const summary = summarizeBulk(plan, [
        success,
        success,
        BulkReceipt.cases.Failed.make({ key: "unknown", reason: "Ignored" }),
      ]);

      expect(plan.steps.map(({ key }) => key)).toEqual(["first"]);
      expect(plan.skipped.map(({ key }) => key)).toEqual([
        "missing",
        "alias",
        "blocked",
      ]);
      expect(summary.pending).toEqual(["first"]);
      expect(summary.succeeded).toEqual([]);
      expect(summary.undo).toEqual([]);
    })
);

it.effect.each(["delete", "duplicate"] satisfies ("delete" | "duplicate")[])(
  "bound bulk %s uses the existing single-event writer, with no new transport or series-wide path",
  (operation) =>
    Effect.gen(function* existingBulkWriter() {
      const event = {
        ...editorOriginal,
        end: { dateTime: "2026-10-19T10:00:57-07:00" },
        start: { dateTime: "2026-10-19T09:00:23-07:00" },
      };

      const plan = planBulk(
        operation,
        ["selected-instance"],
        [
          {
            event,
            key: "selected-instance",
            permission: BulkPermission.cases.Allowed.make({}),
          },
        ],
        opening
      );

      const [step] = plan.steps;

      if (step === undefined) {
        return yield* Effect.die("Missing bulk writer fixture");
      }

      const prepared = yield* prepare(step);

      const bound = yield* bindBulkWrite(step, {
        ...prepared,
        emailNeeded: true,
        sendUpdates: "all",
      });

      const created: (typeof CreateEventInput.Type)[] = [];
      const deletion: (typeof DeleteCommand.Type)[] = [];

      const client = CalendarEditingClient.of({
        createEvent: (input) =>
          Effect.sync(() => {
            created.push(input);

            return { ...event, ...input.event, eventId: input.id };
          }),
        deleteEvent: () =>
          Effect.die("A staged delete must not commit immediately."),
        getEvent: () =>
          Effect.die("Binding a prepared plan must not read again."),
        moveAndRetimeSeries: () => Effect.die("No series operation in bulk."),
        moveEvent: () => Effect.die("No relocation in this bulk contract."),
        moveSupport: "notAvailable",
        rsvp: () => Effect.die("No RSVP in bulk."),
        updateEvent: () =>
          Effect.die(
            "No existing-event update for duplicate or staged delete."
          ),
      });

      yield* writeEditor(bound).pipe(
        Effect.provideService(CalendarEditingClient, client),
        Effect.provideService(
          DeletionSession,
          DeletionSession.of({
            dispatch: (command) =>
              Effect.sync(() => {
                deletion.push(command);
              }),
            subscribe: Effect.succeed(Stream.empty),
          })
        )
      );

      if (operation === "duplicate") {
        expect(created).toHaveLength(1);
        expect(created[0]?.event.start).toEqual(event.start);
        expect(created[0]?.event.end).toEqual(event.end);
        expect(created[0]?.event.recurrence).toEqual([]);
        expect(created[0]?.sendUpdates).toBe("none");
        expect(deletion).toEqual([]);
      } else {
        expect(created).toEqual([]);
        expect(deletion).toHaveLength(1);
        const [command] = deletion;

        if (command === undefined || !DeleteCommand.guards.Begin(command)) {
          return yield* Effect.die(
            "Expected the existing staged-delete command."
          );
        }

        expect(command.intent.request).toMatchObject({
          eventId: event.eventId,
          scope: "single",
          sendUpdates: "none",
        });
        expect(command.intent.event).toEqual(event);
      }

      return yield* Effect.void;
    })
);

it.effect(
  "single-instance binding refuses foreign originals, unsupported scopes and unrelated prepared operations",
  () =>
    Effect.gen(function* refuseUnrelatedPlans() {
      const plan = planBulk(
        "delete",
        ["event"],
        [
          {
            event: editorOriginal,
            key: "event",
            permission: BulkPermission.cases.Allowed.make({}),
          },
        ],
        opening
      );

      const [step] = plan.steps;

      if (step === undefined) {
        return yield* Effect.die("Missing fixture step");
      }

      const prepared = yield* prepare(step);

      const variants = [
        { ...prepared, choices: ["all"] satisfies typeof prepared.choices },
        { ...prepared, calendarMoved: true },
        { ...prepared, removeRecurrence: true },
        {
          ...prepared,
          session: {
            ...prepared.session,
            original: Option.some({ ...editorOriginal, eventId: "other" }),
          },
        },
        {
          ...prepared,
          session: LoadedEditor.make({
            ...prepared.session,
            operation: "save",
          }),
        },
      ];

      for (const variant of variants) {
        expect(
          (yield* bindBulkWrite(step, variant).pipe(Effect.flip)).message
        ).toContain("single-instance");
      }

      return yield* Effect.void;
    })
);

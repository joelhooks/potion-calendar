import { equivalenceKey } from "@calendar/calendar/contracts";
import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { RemoteSession } from "../src/client/app.js";
import { calendarKey } from "../src/client/calendar-state.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { copyEvent, copyFixtureModel } from "./equivalent-fixture.js";

const GeneratedCopy = Schema.Struct({
  known: Schema.Boolean,
  meeting: Schema.Int.check(Schema.isBetween({ maximum: 3, minimum: 0 })),
  order: Schema.Int,
  work: Schema.Boolean,
});

const generatedEvents = (
  copies: readonly (typeof GeneratedCopy.Type)[]
): readonly CalendarEventValue[] =>
  copies.slice(0, 30).map((copy, index) =>
    copyEvent(
      {
        accountId: copy.work ? "work" : "personal",
        calendarId: copy.work ? "primary" : "personal",
      },
      {
        eventId: `generated-${index}`,
        iCalUID: copy.known ? `meeting-${copy.meeting}` : undefined,
      }
    )
  );

it.effect.prop(
  "merging preserves every calendar within each invitation and never merges unknown identities",
  { copies: Schema.Array(GeneratedCopy) },
  ({ copies }) =>
    Effect.sync(() => {
      const events = generatedEvents(copies);
      const shown = visibleEvents(copyFixtureModel(events));

      const identities = new Set(
        events.flatMap((event) => {
          const key = equivalenceKey(event);

          return key === undefined ? [] : [key];
        })
      );

      expect(shown).toHaveLength(
        identities.size +
          events.filter((event) => equivalenceKey(event) === undefined).length
      );

      for (const event of events) {
        const key = equivalenceKey(event);

        const group = shown.find((item) =>
          key === undefined
            ? item.source.eventId === event.eventId
            : equivalenceKey(item.source) === key
        );

        expect(
          group?.copies.map((copy) =>
            calendarKey(copy.calendar.accountId, copy.calendar.calendarId)
          )
        ).toContain(calendarKey(event.accountId, event.calendarId));

        if (key === undefined) {
          expect(group?.copies).toHaveLength(1);
        }
      }
    })
);

it.effect.prop(
  "representatives, group keys, and calendar ribbons do not depend on input order",
  { copies: Schema.Array(GeneratedCopy) },
  ({ copies }) =>
    Effect.sync(() => {
      const events = generatedEvents(copies);

      const shuffled = events
        .map((event, index) => ({
          event,
          index,
          order: copies[index]?.order ?? 0,
        }))
        .toSorted(
          (left, right) => left.order - right.order || right.index - left.index
        )
        .map((item) => item.event);

      const shuffledModel = copyFixtureModel(shuffled);

      const reordered = {
        ...shuffledModel,
        calendar: {
          ...shuffledModel.calendar,
          calendars: shuffledModel.calendar.calendars.toReversed(),
          reads: shuffledModel.calendar.reads.toReversed(),
        },
      };

      expect(visibleEvents(reordered)).toEqual(
        visibleEvents(copyFixtureModel(events))
      );
    })
);

it.effect(
  "copy priority follows sign-in account, calendar primary status, and stable calendar-id ties",
  () =>
    Effect.sync(() => {
      const refs = [
        { accountId: "personal", calendarId: "other" },
        { accountId: "personal", calendarId: "personal" },
        { accountId: "work", calendarId: "hidden" },
        { accountId: "work", calendarId: "primary" },
      ];

      let events = refs.map((ref) => copyEvent(ref));

      for (const expected of refs.toReversed()) {
        const model = copyFixtureModel(events);

        const session = RemoteSession.Success({
          data: {
            accounts: [
              {
                disconnected: false,
                email: "personal@example.test",
                id: "personal",
              },
              { disconnected: false, email: "owner@example.test", id: "work" },
            ],
            user: { email: "owner@example.test", id: "person", name: "Owner" },
          },
        });

        const [representative] = visibleEvents({ ...model, session });
        expect(representative?.calendar).toMatchObject(expected);
        expect(representative?.copies).toHaveLength(events.length);
        events = events.filter(
          (event) =>
            event.accountId !== expected.accountId ||
            event.calendarId !== expected.calendarId
        );
      }

      const model = copyFixtureModel([
        copyEvent({ accountId: "work", calendarId: "hidden" }),
        copyEvent({ accountId: "work", calendarId: "a-first" }),
      ]);

      const secondary = model.calendar.calendars.find(
        (calendar) => calendar.calendarId === "hidden"
      );

      expect(secondary).toBeDefined();

      if (secondary !== undefined) {
        const [representative] = visibleEvents({
          ...model,
          calendar: {
            ...model.calendar,
            calendars: [
              ...model.calendar.calendars,
              { ...secondary, calendarId: "a-first" },
            ],
          },
        });

        expect(representative?.calendar.calendarId).toBe("a-first");
      }
    })
);

it.effect("other-account ties follow session order before calendar id", () =>
  Effect.sync(() => {
    const base = copyFixtureModel();

    const session = RemoteSession.Success({
      data: {
        accounts: [
          {
            disconnected: false,
            email: "owner@example.test",
            id: "sign-in-without-visible-calendars",
          },
          { disconnected: false, email: "work@example.test", id: "work" },
          {
            disconnected: false,
            email: "personal@example.test",
            id: "personal",
          },
        ],
        user: { email: "owner@example.test", id: "person", name: "Owner" },
      },
    });

    const model = {
      ...base,
      calendar: { ...base.calendar, reads: base.calendar.reads.toReversed() },
      session,
    };

    expect(
      visibleEvents(model).find((event) => event.title === "Shared conference")
        ?.source.accountId
    ).toBe("work");
  })
);

it.effect(
  "an unmatched sign-in email falls back to session account order",
  () =>
    Effect.sync(() => {
      const model = copyFixtureModel();

      const session = RemoteSession.Success({
        data: {
          accounts: [
            {
              disconnected: false,
              email: "personal@example.test",
              id: "personal",
            },
            { disconnected: false, email: "owner@example.test", id: "work" },
          ],
          user: {
            email: "unmatched@example.test",
            id: "person",
            name: "Owner",
          },
        },
      });

      expect(
        visibleEvents({ ...model, session }).find(
          (event) => event.title === "Shared conference"
        )?.source.accountId
      ).toBe("personal");
    })
);

it.effect(
  "missing UIDs and incomplete recurring identities never merge despite matching title and time",
  () =>
    Effect.sync(() => {
      const events = ["work", "personal"].flatMap((accountId) => [
        copyEvent(
          {
            accountId,
            calendarId: accountId === "work" ? "primary" : "personal",
          },
          { eventId: "unknown", iCalUID: undefined }
        ),
        copyEvent(
          {
            accountId,
            calendarId: accountId === "work" ? "primary" : "personal",
          },
          { eventId: "unanchored", recurringEventId: "series" }
        ),
      ]);

      expect(visibleEvents(copyFixtureModel(events))).toHaveLength(4);
    })
);

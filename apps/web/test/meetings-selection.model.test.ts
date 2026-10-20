import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import { eventKey, RemoteEvents } from "../src/client/calendar-state.js";
import { keyboardEvents } from "../src/client/keyboard/registry.js";
import { savedMeetings } from "../src/client/meetings/source.js";
import type { UpcomingQueryValue } from "../src/client/upcoming/model.js";
import { visibleDays } from "../src/layout/navigation.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { meetingInstant, savedMeeting } from "./meetings-fixture.js";
import {
  outsideSearchEvent,
  searchResultsFixture,
  searchResponse,
} from "./search-fixture.js";
import { upcomingFixture, upcomingPerson } from "./upcoming-fixture.js";

const fixture = (merge = true) => {
  const initial = upcomingFixture();

  const base = {
    ...initial,
    calendar: {
      ...initial.calendar,
      mergeDuplicates: merge,
      navigation: {
        ...initial.calendar.navigation,
        anchor: initial.calendar.navigation.anchor - 30,
      },
    },
  };

  const event = savedMeeting(0, 60, 90);

  const { model } = update(
    base,
    Message.ReceivedUpcoming({
      personId: upcomingPerson,
      request: base.upcoming.request,
      result: { events: [event], versions: [] },
    })
  );

  const [candidate] = savedMeetings(model);

  if (candidate === undefined) {
    throw new Error("Missing saved meeting fixture");
  }

  return { candidate, event, model };
};

it.effect.prop(
  "selecting merged or unmerged saved upcoming data does not navigate or fetch",
  { merge: Schema.Boolean },
  ({ merge }) =>
    Effect.sync(() => {
      const { candidate, event, model } = fixture(merge);
      const dates = visibleDays(model.calendar.navigation);
      expect(dates).not.toContain(candidate.item.startDay);

      const selected = update(
        model,
        Message.ClickedEvent({
          key: merge ? candidate.item.key : eventKey(event),
        })
      );

      expect(selected.commands).toBeUndefined();
      expect(selected.model.calendar.navigation).toBe(
        model.calendar.navigation
      );
      expect(visibleDays(selected.model.calendar.navigation)).toEqual(dates);
      expect(
        visibleEvents(selected.model).filter((item) => item.selected)
      ).toHaveLength(1);
      expect(
        keyboardEvents(selected.model).find((item) => item.selected)?.title
      ).toBe("Meeting 0");

      const cleared = update(selected.model, Message.ClosedDetail()).model;
      expect(
        visibleEvents(cleared).some(
          (item) => item.source.eventId === "meeting-0"
        )
      ).toBe(false);
    })
);

it.effect(
  "fresh upcoming data invalidates cached selected details and removal retires the projection",
  () =>
    Effect.sync(() => {
      const { candidate, event, model } = fixture();

      const selected = update(
        model,
        Message.ClickedEvent({ key: candidate.item.key })
      ).model;

      expect(
        keyboardEvents(selected).find((item) => item.selected)?.title
      ).toBe("Meeting 0");

      const pending = {
        ...selected,
        upcoming: {
          ...selected.upcoming,
          query: selected.upcoming.query.pipe(
            Option.map((query): UpcomingQueryValue => ({
              ...query,
              origin: "live",
            }))
          ),
        },
      };

      const refreshed = update(
        pending,
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request: pending.upcoming.request,
          result: {
            events: [
              {
                ...event,
                end: { dateTime: meetingInstant(120) },
                title: "Changed saved title",
              },
            ],
            versions: [],
          },
        })
      ).model;

      expect(refreshed.calendar).toBe(selected.calendar);
      expect(
        keyboardEvents(refreshed).find((item) => item.selected)?.title
      ).toBe("Changed saved title");

      const removed = update(
        refreshed,
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request: refreshed.upcoming.request,
          result: { events: [], versions: [] },
        })
      ).model;

      expect(
        visibleEvents(removed).find((item) => item.selected)
      ).toBeUndefined();
    })
);

it.effect(
  "search selection followed by an upcoming selection projects exactly one extra event",
  () =>
    Effect.sync(() => {
      const initial = searchResultsFixture();

      const searched = update(
        {
          ...initial,
          search: {
            ...initial.search,
            response: Option.some(searchResponse([outsideSearchEvent])),
          },
        },
        Message.SearchSelect({ goTo: false, key: eventKey(outsideSearchEvent) })
      ).model;

      const event = savedMeeting(8, 60, 90);

      const model = {
        ...searched,
        upcoming: {
          ...searched.upcoming,
          data: RemoteEvents.Success({
            data: { events: [event], versions: [] },
          }),
        },
      };

      const [candidate] = savedMeetings(model);

      if (candidate === undefined) {
        throw new Error("Missing upcoming selection fixture");
      }

      expect(
        visibleEvents(model).some(
          (item) => item.source.eventId === outsideSearchEvent.eventId
        )
      ).toBe(true);

      const selected = update(
        model,
        Message.ClickedEvent({ key: candidate.item.key })
      );

      const projected = visibleEvents(selected.model).filter(
        (item) =>
          item.source.eventId === outsideSearchEvent.eventId ||
          item.source.eventId === event.eventId
      );

      expect(selected.commands).toBeUndefined();
      expect(projected).toHaveLength(1);
      expect(projected[0]?.source.eventId).toBe(event.eventId);
      expect(projected[0]?.selected).toBe(true);
    })
);

it.effect("range data wins over a projected copy of the same saved event", () =>
  Effect.sync(() => {
    const { candidate, event, model } = fixture();

    const populated = {
      ...model,
      calendar: {
        ...model.calendar,
        reads: model.calendar.reads.map((read) => ({
          ...read,
          events: RemoteEvents.Success({
            data: {
              events: [{ ...event, title: "Range authority" }],
              versions: [],
            },
          }),
        })),
      },
    };

    const selected = update(
      populated,
      Message.ClickedEvent({ key: candidate.item.key })
    ).model;

    expect(
      visibleEvents(selected).filter((item) => item.selected)
    ).toHaveLength(1);
    expect(visibleEvents(selected).find((item) => item.selected)?.title).toBe(
      "Range authority"
    );
  })
);

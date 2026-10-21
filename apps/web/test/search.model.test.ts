import { CalendarEvent } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Match, Option, Schema } from "effect";
import { AsyncData } from "foldkit";
import { fromString } from "foldkit/url";

import { Message, update } from "../src/client/app.js";
import {
  RemoteEvents,
  calendarKey,
  eventKey,
} from "../src/client/calendar-state.js";
import { commandChoices, enterChoice } from "../src/client/keyboard/choices.js";
import { resolveBinding } from "../src/client/keyboard/input.js";
import { SearchNotice } from "../src/client/search/model.js";
import { dayInZone } from "../src/layout/navigation.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { CalendarRoute } from "../src/layout/route.js";
import { searchDays, searchResult } from "../src/layout/search-results.js";
import { fixtureEvents } from "./fixture.js";
import {
  outsideSearchEvent,
  searchResponse,
  searchResultsFixture,
} from "./search-fixture.js";

it.prop(
  "a nonblank query clears selection, while clear removes data and saved scroll then refocuses",
  { text: Schema.Literals(["planning", " team ", "owner@example.test"]) },
  ({ text }) => {
    const base = searchResultsFixture();

    const model = {
      ...base,
      calendar: { ...base.calendar, selected: ["previous"] },
      search: { ...base.search, scroll: Option.some(420) },
    };

    const typed = update(model, Message.SearchInput({ text }));
    expect(typed.model.calendar.selected).toEqual([]);
    expect(typed.model.calendar.navigation).toBe(model.calendar.navigation);
    expect(typed.model.search.revision).toBe(model.search.revision + 1);
    const cleared = update(typed.model, Message.SearchClear());
    expect(cleared.model.search.text).toBe("");
    expect(cleared.model.search.response).toEqual(Option.none());
    expect(cleared.model.search.scroll).toEqual(Option.none());
    expect(cleared.commands?.map((command) => command.name)).toEqual([
      "NavigateRoute",
      "FocusSearch",
    ]);
  }
);

it.prop(
  "only an empty or whitespace search returns on blur; Escape only blurs",
  { text: Schema.Literals(["", "   ", "team"]) },
  ({ text }) => {
    const base = searchResultsFixture();
    const model = { ...base, search: { ...base.search, text } };
    const blur = update(model, Message.SearchBlur());
    expect(blur.commands?.map((command) => command.name) ?? []).toEqual(
      text.trim() === "" ? ["BackRoute"] : []
    );
    expect(
      update(model, Message.SearchEscape()).commands?.map(
        (command) => command.name
      )
    ).toEqual(["BlurSearch"]);
  }
);

it.prop(
  "person, revision, query and zone reject a stale result even when other fields match",
  { mismatch: Schema.Literals(["person", "revision", "query", "zone"]) },
  ({ mismatch }) => {
    const model = searchResultsFixture();

    const task = {
      personId: Option.getOrThrow(model.person),
      request: {
        query: model.search.text,
        timeZone: model.calendar.zone,
        weekStartsOn: 0 as const,
      },
      revision: model.search.revision,
    };

    const stale = Match.value(mismatch).pipe(
      Match.when("person", () => ({ ...task, personId: "other-person" })),
      Match.when("revision", () => ({ ...task, revision: task.revision - 1 })),
      Match.when("query", () => ({
        ...task,
        request: { ...task.request, query: "old query" },
      })),
      Match.when("zone", () => ({
        ...task,
        request: { ...task.request, timeZone: "UTC" },
      })),
      Match.exhaustive
    );

    const next = update(
      model,
      Message.ReceivedSearch({
        notice: SearchNotice.cases.Ready.make({
          response: searchResponse([]),
          task: stale,
        }),
      })
    );

    expect(next.model).toBe(model);
    expect(next.commands ?? []).toHaveLength(0);
  }
);

it("a current response commits the debounced URL and preserves scroll on updates", () => {
  const base = searchResultsFixture();

  const model = {
    ...base,
    search: { ...base.search, scroll: Option.some(320), text: "updated" },
  };

  const task = {
    personId: Option.getOrThrow(model.person),
    request: {
      query: "updated",
      timeZone: model.calendar.zone,
      weekStartsOn: 0 as const,
    },
    revision: model.search.revision,
  };

  const next = update(
    model,
    Message.ReceivedSearch({
      notice: SearchNotice.cases.Ready.make({
        response: searchResponse(),
        task,
      }),
    })
  );

  expect(next.model.search.urlQuery).toBe("updated");
  expect(next.model.search.scroll).toEqual(Option.some(320));
  expect(next.commands?.map((command) => command.name)).toEqual([
    "NavigateRoute",
    "RestoreSearchScroll",
  ]);
  expect(next.commands?.at(1)?.args).toEqual({ position: Option.some(320) });
});

it.prop(
  "dated sections use the primary zone and insert Today when every result is past",
  {
    offsets: Schema.Array(
      Schema.Int.check(Schema.isBetween({ maximum: 30, minimum: -30 }))
    ).check(Schema.isMinLength(1), Schema.isMaxLength(15)),
    zone: Schema.Literals([
      "America/Los_Angeles",
      "Asia/Tokyo",
      "Pacific/Auckland",
    ]),
  },
  ({ offsets, zone }) => {
    const base = searchResultsFixture();
    const [template] = Option.getOrThrow(base.search.response).results;

    if (template === undefined) {
      throw new Error("Missing search fixture");
    }

    const today = dayInZone(base.calendar.now, zone);

    const rows = offsets.map((offset, index) => ({
      ...template,
      event: { ...template.event, eventId: String(index) },
      startMillis: base.calendar.now + offset * 86_400_000,
    }));

    const groups = searchDays(rows, base.calendar.now, zone);
    expect(groups.filter((group) => group.today)).toHaveLength(1);
    expect(groups.find((group) => group.today)?.day).toBe(today);
    expect(groups.find((group) => group.today)?.noUpcoming).toBe(
      rows.every((row) => dayInZone(row.startMillis, zone) < today)
    );
    expect(groups.flatMap((group) => group.results)).toHaveLength(rows.length);
    expect(groups.map((group) => group.day)).toEqual(
      groups.map((group) => group.day).toSorted((a, b) => a - b)
    );

    for (const group of groups) {
      expect(
        group.results.every(
          (row) => dayInZone(row.startMillis, zone) === group.day
        )
      ).toBe(true);
    }
  }
);

it("selection reveals a hidden calendar, warms its date and leaves grid navigation alone", () => {
  const model = searchResultsFixture();

  const row = Option.getOrThrow(model.search.response).results.find(
    (result) => result.event.calendarId === "hidden"
  );

  if (row === undefined) {
    throw new Error("Missing hidden search fixture");
  }

  expect(model.calendar.hidden).toContain(
    calendarKey(row.calendar.accountId, row.calendar.calendarId)
  );

  const next = update(
    model,
    Message.SearchSelect({ goTo: false, key: eventKey(row.event) })
  );

  expect(next.model.calendar.hidden).not.toContain(
    calendarKey(row.calendar.accountId, row.calendar.calendarId)
  );
  expect(next.model.calendar.selected).toEqual([eventKey(row.event)]);
  expect(next.model.calendar.navigation).toBe(model.calendar.navigation);
  expect(next.model.route).toEqual(model.route);
  expect(
    next.commands?.some((command) => command.name === "SavePreferences")
  ).toBe(true);
  expect(
    next.commands?.find((command) => command.name === "PrefetchSearchDate")
      ?.args
  ).toMatchObject({
    prefetch: {
      day: dayInZone(row.startMillis, model.calendar.zone),
      timeZone: model.calendar.zone,
    },
  });
});

it("out-of-range selection uses existing details, go-to moves the grid, and clearing removes only the projection", () => {
  const base = searchResultsFixture();

  const model = {
    ...base,
    search: {
      ...base.search,
      response: Option.some(searchResponse([outsideSearchEvent])),
    },
  };

  const key = eventKey(outsideSearchEvent);

  const selected = update(
    model,
    Message.SearchSelect({ goTo: false, key })
  ).model;

  expect(
    visibleEvents(selected).find((event) => event.selected)?.source
  ).toEqual(outsideSearchEvent);
  expect(selected.calendar.navigation).toBe(model.calendar.navigation);
  const cleared = update(selected, Message.ClosedDetail()).model;
  expect(
    visibleEvents(cleared).some(
      (event) => event.source.eventId === outsideSearchEvent.eventId
    )
  ).toBe(false);
  const moved = update(model, Message.SearchSelect({ goTo: true, key }));
  expect(moved.model.calendar.navigation.anchor).toBe(
    dayInZone(
      Option.getOrThrow(model.search.response).results[0]?.startMillis ?? 0,
      model.calendar.zone
    )
  );
  expect(moved.model.route._tag).toBe("Calendar");
  expect(moved.model.calendar.selected).toEqual(selected.calendar.selected);
});

it("range data wins over a selected search duplicate, including edits", () => {
  const base = searchResultsFixture();

  const row = searchResult(
    base,
    eventKey(
      Option.getOrThrow(base.search.response).results[0]?.event ??
        outsideSearchEvent
    )
  );

  if (row === undefined) {
    throw new Error("Missing duplicate fixture");
  }

  const model = {
    ...base,
    calendar: {
      ...base.calendar,
      mergeDuplicates: false,
      reads: base.calendar.reads.map((read) => {
        const data = AsyncData.getData(read.events);

        return Option.isNone(data)
          ? read
          : {
              ...read,
              events: RemoteEvents.Success({
                data: {
                  ...data.value,
                  events: data.value.events.map((event) =>
                    eventKey(event) === eventKey(row.event)
                      ? { ...event, title: "Fresh range title" }
                      : event
                  ),
                },
              }),
            };
      }),
      selected: [eventKey(row.event)],
    },
  };

  const events = visibleEvents(model).filter(
    (event) => event.key === eventKey(row.event)
  );

  expect(events).toHaveLength(1);
  expect(events[0]?.source.title).toBe("Fresh range title");
  expect(row.event.title).not.toBe("Fresh range title");
});

it("a delayed self URL update keeps newer typing, while a menu handoff deliberately replaces it", () => {
  const base = searchResultsFixture();

  const model = {
    ...base,
    search: {
      ...base.search,
      phase: "Debouncing" as const,
      text: "new pending draft",
    },
  };

  const url = Option.getOrThrow(
    fromString("https://calendar.test/search?q=planning")
  );

  expect(
    update(model, Message.BrowserUrlChanged({ url })).model.search.text
  ).toBe("new pending draft");

  const handoff = update(
    model,
    Message.SearchOpened({ query: Option.some("planning") })
  );

  expect(handoff.model.search.text).toBe("planning");
  expect(handoff.model.keyboard.screen).toBe("closed");
});

it("search opens a declined result even when the grid hides declined events", () => {
  const base = searchResultsFixture();

  const response = searchResponse(
    fixtureEvents.filter((event) => event.eventId === "declined")
  );

  const [row] = response.results;

  if (row === undefined) {
    throw new Error("Missing declined fixture");
  }

  const model = {
    ...base,
    calendar: { ...base.calendar, hideDeclined: true },
    search: { ...base.search, response: Option.some(response) },
  };

  const selected = update(
    model,
    Message.SearchSelect({ goTo: false, key: eventKey(row.event) })
  ).model;

  expect(
    visibleEvents(selected).find((event) => event.selected)?.source.eventId
  ).toBe("declined");
});

it("a fresh range copy stays selected even if its optional UID metadata differs", () => {
  const base = searchResultsFixture();

  const fresh = CalendarEvent.make({
    ...outsideSearchEvent,
    iCalUID: undefined,
    title: "Fresh from range",
  });

  const model = {
    ...base,
    calendar: {
      ...base.calendar,
      reads: [
        {
          accountId: "work",
          events: RemoteEvents.Success({
            data: { events: [fresh], versions: [] },
          }),
        },
      ],
    },
    search: {
      ...base.search,
      response: Option.some(searchResponse([outsideSearchEvent])),
    },
  };

  const selected = update(
    model,
    Message.SearchSelect({ goTo: false, key: eventKey(outsideSearchEvent) })
  ).model;

  expect(
    visibleEvents(selected).find((event) => event.selected)?.source.title
  ).toBe("Fresh from range");
});

it("a refreshed selected search event updates command permissions without replacing the range model", () => {
  const base = searchResultsFixture();

  const permitted = CalendarEvent.make({
    ...outsideSearchEvent,
    guestsCanModify: true,
  });

  const model = {
    ...base,
    search: {
      ...base.search,
      response: Option.some(searchResponse([permitted])),
    },
  };

  const selected = update(
    model,
    Message.SearchSelect({ goTo: false, key: eventKey(permitted) })
  ).model;

  const menu = {
    ...selected,
    keyboard: { ...selected.keyboard, screen: "commands" as const },
  };

  expect(
    commandChoices(menu).find((choice) => choice.id === "edit-title")?.disabled
  ).toBe(false);

  const refreshed = {
    ...menu,
    search: {
      ...menu.search,
      response: Option.some(
        searchResponse([
          CalendarEvent.make({ ...permitted, guestsCanModify: false }),
        ])
      ),
    },
  };

  expect(refreshed.calendar).toBe(menu.calendar);
  expect(
    commandChoices(refreshed).find((choice) => choice.id === "edit-title")
      ?.disabled
  ).toBe(true);
});

it.prop(
  "late panel events cannot leave or mutate another page",
  { kind: Schema.Literals(["input", "clear", "blur", "select"]) },
  ({ kind }) => {
    const base = searchResultsFixture();
    const [row] = Option.getOrThrow(base.search.response).results;

    if (row === undefined) {
      throw new Error("Missing search result");
    }

    const model = {
      ...base,
      calendar: { ...base.calendar, selected: ["grid-selection"] },
      route: CalendarRoute.make({}),
      search:
        kind === "blur"
          ? { ...base.search, response: Option.none(), text: "" }
          : base.search,
    };

    const message = Match.value(kind).pipe(
      Match.when("input", () => Message.SearchInput({ text: "late typing" })),
      Match.when("clear", () => Message.SearchClear()),
      Match.when("blur", () => Message.SearchBlur()),
      Match.when("select", () =>
        Message.SearchSelect({ goTo: false, key: eventKey(row.event) })
      ),
      Match.exhaustive
    );

    const result = update(model, message);
    expect(result.model).toBe(model);
    expect(result.commands ?? []).toHaveLength(0);
  }
);

it("Slash and Mod-F share the registry, and a low-ranked handoff preserves the original query", () => {
  const model = searchResultsFixture();

  for (const input of [
    { key: "/", mod: false },
    { key: "f", mod: true },
  ]) {
    expect(
      resolveBinding(model, { ...input, alt: false, shift: false }, 0, "app")
        .action?.id
    ).toBe("search-events");
  }

  const menu = {
    ...model,
    keyboard: {
      ...model.keyboard,
      query: "Product Planning",
      screen: "commands" as const,
    },
  };

  const choices = commandChoices(menu);
  expect(choices.at(-1)?.title).toBe("Search events for “Product Planning”");
  expect(choices.at(-1)?.message).toEqual(
    Message.SearchOpened({ query: Option.some("Product Planning") })
  );
  expect(
    enterChoice({
      ...menu,
      keyboard: { ...menu.keyboard, query: "refresh calendars" },
    })?.id
  ).toBe("refresh");
});

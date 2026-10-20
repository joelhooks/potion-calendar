import { Option, Predicate } from "effect";
import type { Update } from "foldkit";

import { dayInZone } from "../../layout/navigation.js";
import { CalendarRoute, SearchRoute } from "../../layout/route.js";
import type { RouteValue } from "../../layout/route.js";
import {
  searchResult,
  searchSelectionKey,
} from "../../layout/search-results.js";
import type { AppModel } from "../app.js";
import { SavePreferences } from "../commands.js";
import { closeKeyboard } from "../keyboard/update.js";
import type { AppMessage } from "../message.js";
import { BackRoute, NavigateRoute } from "../routing.js";
import { preferenceSnapshot } from "../settings/update.js";
import { calendarVisible, chooseVisibility } from "../settings/visibility.js";
import type { CalendarSearchClient } from "./client.js";
import {
  FocusSearch,
  PrefetchSearchDate,
  RestoreSearchScroll,
} from "./commands.js";
import type { SearchNotice } from "./model.js";

type SearchResult = Update.Return<AppModel, AppMessage, CalendarSearchClient>;

export const syncSearchRoute = (
  model: AppModel,
  route: RouteValue
): AppModel => {
  if (
    !Predicate.isTagged(route, "Search") ||
    (Predicate.isTagged(model.route, "Search") &&
      route.q === model.search.urlQuery)
  ) {
    return { ...model, route };
  }

  const blank = route.q.trim() === "";
  const same = model.search.text === route.q;

  return {
    ...model,
    calendar:
      blank || same || Option.isNone(model.calendar.selected)
        ? model.calendar
        : { ...model.calendar, selected: Option.none() },
    route,
    search: {
      ...model.search,
      menu: Option.none(),
      phase: blank ? "Idle" : "Debouncing",
      problem: Option.none(),
      response: blank || !same ? Option.none() : model.search.response,
      revision: model.search.revision + 1,
      scroll: same ? model.search.scroll : Option.none(),
      text: route.q,
      urlQuery: route.q,
    },
  };
};

export const searchInput = (model: AppModel, text: string): SearchResult => {
  if (!Predicate.isTagged(model.route, "Search")) {
    return { model };
  }

  const blank = text.trim() === "";

  return {
    model: {
      ...model,
      calendar:
        blank || Option.isNone(model.calendar.selected)
          ? model.calendar
          : { ...model.calendar, selected: Option.none() },
      search: {
        ...model.search,
        menu: Option.none(),
        phase: blank ? "Idle" : "Debouncing",
        problem: Option.none(),
        response: blank ? Option.none() : model.search.response,
        revision: model.search.revision + 1,
        scroll: blank ? Option.none() : model.search.scroll,
        text,
      },
    },
  };
};

export const searchOpen = (
  model: AppModel,
  query: Option.Option<string>
): SearchResult => {
  if (Predicate.isTagged(model.route, "Search") && Option.isNone(query)) {
    return { commands: [FocusSearch()], model: closeKeyboard(model) };
  }

  const route = SearchRoute.make({ q: Option.getOrElse(query, () => "") });

  const routed = syncSearchRoute(closeKeyboard(model), route);

  return {
    commands: [NavigateRoute({ replace: false, route }), FocusSearch()],
    model: Option.isSome(query) ? searchInput(routed, route.q).model : routed,
  };
};

export const clearSearch = (model: AppModel): SearchResult => {
  if (!Predicate.isTagged(model.route, "Search")) {
    return { model };
  }

  const { model: next } = searchInput(model, "");

  return {
    commands: [
      NavigateRoute({ replace: true, route: SearchRoute.make({ q: "" }) }),
      FocusSearch(),
    ],
    model: { ...next, search: { ...next.search, urlQuery: "" } },
  };
};

export const blurSearch = (model: AppModel): SearchResult =>
  Predicate.isTagged(model.route, "Search") && model.search.text.trim() === ""
    ? { commands: [BackRoute()], model }
    : { model };

export const receiveSearch = (
  model: AppModel,
  notice: typeof SearchNotice.Type
): SearchResult => {
  const { task } = notice;

  if (
    !Predicate.isTagged(model.route, "Search") ||
    !Option.contains(model.person, task.personId) ||
    task.revision !== model.search.revision ||
    task.request.query !== model.search.text ||
    task.request.timeZone !== model.calendar.zone ||
    task.request.weekStartsOn !== (model.calendar.navigation.weekStartsOn ?? 0)
  ) {
    return { model };
  }

  const retained =
    model.search.text.trim() === "" ? Option.none() : model.search.response;

  const updateUrl =
    !Predicate.isTagged(notice, "Debouncing") &&
    model.search.urlQuery !== task.request.query;

  const commands = [
    ...(updateUrl
      ? [
          NavigateRoute({
            replace: true,
            route: SearchRoute.make({ q: task.request.query }),
          }),
        ]
      : []),
    ...(Predicate.isTagged(notice, "Ready")
      ? [RestoreSearchScroll({ position: model.search.scroll })]
      : []),
  ];

  return {
    commands,
    model: {
      ...model,
      search: {
        ...model.search,
        phase: notice._tag,
        problem: Predicate.isTagged(notice, "Failed")
          ? Option.some(notice.problem)
          : Option.none(),
        response: Predicate.isTagged(notice, "Ready")
          ? Option.some(notice.response)
          : retained,
        urlQuery: updateUrl ? task.request.query : model.search.urlQuery,
      },
    },
  };
};

export const refreshSearch = (model: AppModel): AppModel =>
  Predicate.isTagged(model.route, "Search") && model.search.text.trim() !== ""
    ? {
        ...model,
        search: {
          ...model.search,
          phase: "Debouncing",
          problem: Option.none(),
          revision: model.search.revision + 1,
        },
      }
    : model;

export const selectSearchResult = (
  model: AppModel,
  key: string,
  goTo: boolean
): SearchResult & { readonly reload: boolean } => {
  const result = searchResult(model, key);

  if (
    !Predicate.isTagged(model.route, "Search") ||
    result === undefined ||
    Option.isNone(model.person)
  ) {
    return { model, reload: false };
  }

  const day = dayInZone(result.startMillis, model.calendar.zone);

  const revealed = !calendarVisible(
    result.calendar,
    model.calendar.visibility,
    model.calendar.visibilityMigration
  );

  const known = model.calendar.calendars.some(
    (item) =>
      item.accountId === result.calendar.accountId &&
      item.calendarId === result.calendar.calendarId
  );

  const calendars = known
    ? model.calendar.calendars
    : [...model.calendar.calendars, result.calendar];

  const shown = revealed
    ? chooseVisibility(
        calendars,
        model.calendar.visibility,
        model.calendar.visibilityMigration,
        result.calendar,
        true
      )
    : { hidden: model.calendar.hidden, visibility: model.calendar.visibility };

  const route = goTo ? CalendarRoute.make({}) : model.route;

  return {
    commands: [
      PrefetchSearchDate({
        personId: model.person.value,
        prefetch: {
          calendar: {
            accountId: result.calendar.accountId,
            calendarId: result.calendar.calendarId,
          },
          day,
          timeZone: model.calendar.zone,
        },
        revision: model.search.revision,
      }),
      ...(revealed
        ? [
            SavePreferences({
              person: model.person.value,
              ...preferenceSnapshot({
                ...model,
                calendar: { ...model.calendar, calendars, ...shown },
              }),
            }),
          ]
        : []),
      ...(goTo ? [NavigateRoute({ replace: false, route })] : []),
    ],
    model: {
      ...model,
      calendar: {
        ...model.calendar,
        calendars,
        ...shown,
        navigation: goTo
          ? { ...model.calendar.navigation, anchor: day }
          : model.calendar.navigation,
        selected: Option.some(
          searchSelectionKey(result, model.calendar.mergeDuplicates)
        ),
      },
      route,
      search: { ...model.search, menu: Option.none() },
    },
    reload: goTo || revealed,
  };
};

import { expect, it } from "@effect/vitest";
import { Option, Schema } from "effect";
import { Url } from "foldkit/url";

import { Message, initialModel, update } from "../src/client/app.js";
import {
  AccountSettingsRoute,
  CalendarRoute,
  Route,
  SearchRoute,
  SettingsRoute,
  ShortcutsRoute,
  isDocumentRoute,
  parseRoute,
  printRoute,
} from "../src/layout/route.js";

it.prop(
  "every valid route round trips through a real URL without losing query or account data",
  {
    edge: Schema.Literals(["a+b&c?d#e", "work/📅?id=x", "space and % escaped"]),
    route: Route,
  },
  ({ route, edge }) => {
    for (const value of [
      route,
      SearchRoute.make({ q: edge }),
      AccountSettingsRoute.make({ accountId: edge }),
    ]) {
      const url = new URL(printRoute(value), "https://calendar.test");
      expect(parseRoute(url.pathname, url.search, url.hash)).toEqual(value);
      expect(isDocumentRoute(url.pathname)).toBe(true);
    }
  }
);

it("settings aliases and account path encoding use the agreed URLs", () => {
  expect(parseRoute("/settings")).toEqual(
    SettingsRoute.make({ page: "general" })
  );
  expect(printRoute(SettingsRoute.make({ page: "general" }))).toBe(
    "/settings/general"
  );
  expect(printRoute(SettingsRoute.make({ page: "calendars" }))).toBe(
    "/settings/calendars"
  );
  expect(parseRoute("/settings/notifications")).toEqual(
    SettingsRoute.make({ page: "notifications" })
  );
  expect(printRoute(SettingsRoute.make({ page: "notifications" }))).toBe(
    "/settings/notifications"
  );
  expect(isDocumentRoute("/settings/notifications")).toBe(true);
  const account = "work/📅?a=b&c#fragment";
  expect(printRoute(AccountSettingsRoute.make({ accountId: account }))).toBe(
    `/settings/calendar/${encodeURIComponent(account)}`
  );
  expect(
    parseRoute(`/settings/calendar/${encodeURIComponent(account)}`)
  ).toEqual(AccountSettingsRoute.make({ accountId: account }));
  expect(parseRoute("/search")).toEqual(SearchRoute.make({ q: "" }));
  expect(parseRoute("/search", "q=a%2Bb+%26+c")).toEqual(
    SearchRoute.make({ q: "a+b & c" })
  );
});

it.prop(
  "unknown or malformed paths fall back in the client but are not document routes",
  {
    path: Schema.Literals([
      "/release.json",
      "/.env",
      "/admin",
      "/settings/unknown",
      "/settings/calendar",
      "/settings/calendar/%FF",
      "/settings/calendar/acct/extra",
      "/search/extra",
    ]),
  },
  ({ path }) => {
    expect(parseRoute(path)).toEqual(CalendarRoute.make({}));
    expect(isDocumentRoute(path)).toBe(false);
  }
);

it("shortcut fragments carry only the two known section destinations", () => {
  for (const section of ["calendar-view", "calendar-navigation"] as const) {
    expect(parseRoute("/shortcuts", "", `#${section}`)).toEqual(
      ShortcutsRoute.make({ section: Option.some(section) })
    );
  }

  expect(parseRoute("/shortcuts", "", "#unknown")).toEqual(
    ShortcutsRoute.make({ section: Option.none() })
  );
});

it("route changes preserve calendar navigation and selection", () => {
  const initial = initialModel(0, "UTC");

  const selected = {
    ...initial,
    calendar: { ...initial.calendar, selected: Option.some("chosen-event") },
  };

  const url = Url.make({
    hash: Option.none(),
    host: "calendar.test",
    pathname: "/settings/calendars",
    port: Option.none(),
    protocol: "https:",
    search: Option.none(),
  });

  const next = update(selected, Message.BrowserUrlChanged({ url })).model;
  expect(next.route).toEqual(SettingsRoute.make({ page: "calendars" }));
  expect(next.calendar).toBe(selected.calendar);

  const returned = update(
    next,
    Message.BrowserUrlChanged({ url: { ...url, pathname: "/" } })
  ).model;

  expect(returned.calendar.selected).toEqual(Option.some("chosen-event"));
  expect(returned.calendar.navigation).toBe(selected.calendar.navigation);
});

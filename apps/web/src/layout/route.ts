import { Match, Option, Schema } from "effect";

const RouteText = Schema.String.check(Schema.isPattern(/^[^\uD800-\uDFFF]*$/u));

const AccountId = RouteText.check(
  Schema.isMinLength(1),
  Schema.makeFilter((value: string) => value !== "." && value !== "..")
);

const EncodedAccountId = Schema.StringFromUriComponent.pipe(
  Schema.decodeTo(AccountId)
);

export const CalendarRoute = Schema.TaggedStruct("Calendar", {});

export const SearchRoute = Schema.TaggedStruct("Search", { q: RouteText });

export const SettingsRoute = Schema.TaggedStruct("Settings", {
  page: Schema.Literals(["general", "calendars", "notifications"]),
});

export const AccountSettingsRoute = Schema.TaggedStruct("Settings", {
  accountId: AccountId,
  page: Schema.tag("calendar"),
});

export const ShortcutSection = Schema.Literals([
  "calendar-view",
  "calendar-navigation",
]);

export const ShortcutsRoute = Schema.TaggedStruct("Shortcuts", {
  section: Schema.Option(ShortcutSection),
});

export const Route = Schema.Union([
  CalendarRoute,
  SearchRoute,
  SettingsRoute,
  AccountSettingsRoute,
  ShortcutsRoute,
]);

export type RouteValue = typeof Route.Type;

const recognizedRoute = (
  pathname: string,
  search: string,
  hash: string
): Option.Option<RouteValue> => {
  if (pathname === "/") {
    return Option.some(CalendarRoute.make({}));
  }

  if (pathname === "/search") {
    return Option.some(
      SearchRoute.make({ q: new URLSearchParams(search).get("q") ?? "" })
    );
  }

  if (pathname === "/settings" || pathname === "/settings/general") {
    return Option.some(SettingsRoute.make({ page: "general" }));
  }

  if (pathname === "/settings/notifications") {
    return Option.some(SettingsRoute.make({ page: "notifications" }));
  }

  if (pathname === "/settings/calendars") {
    return Option.some(SettingsRoute.make({ page: "calendars" }));
  }

  if (pathname === "/shortcuts") {
    return Option.some(
      ShortcutsRoute.make({
        section: Schema.decodeUnknownOption(ShortcutSection)(
          hash.replace(/^#/u, "")
        ),
      })
    );
  }

  const encoded = /^\/settings\/calendar\/(?<accountId>[^/]+)$/u.exec(pathname)
    ?.groups?.accountId;

  if (encoded === undefined) {
    return Option.none();
  }

  return Schema.decodeOption(EncodedAccountId)(encoded).pipe(
    Option.map((accountId) => AccountSettingsRoute.make({ accountId }))
  );
};

export const parseRoute = (
  pathname: string,
  search = "",
  hash = ""
): RouteValue =>
  Option.getOrElse(recognizedRoute(pathname, search, hash), () =>
    CalendarRoute.make({})
  );

export const isDocumentRoute = (pathname: string): boolean =>
  Option.isSome(recognizedRoute(pathname, "", ""));

export const printRoute = (route: RouteValue): string =>
  Match.value(route).pipe(
    Match.tag("Calendar", () => "/"),
    Match.tag("Search", ({ q }) => `/search?${new URLSearchParams({ q })}`),
    Match.tag(
      "Shortcuts",
      ({ section }) =>
        `/shortcuts${Option.match(section, { onNone: () => "", onSome: (value) => `#${value}` })}`
    ),
    Match.tag("Settings", (settings) =>
      settings.page === "calendar"
        ? `/settings/calendar/${Schema.encodeSync(EncodedAccountId)(settings.accountId)}`
        : `/settings/${settings.page}`
    ),
    Match.exhaustive
  );

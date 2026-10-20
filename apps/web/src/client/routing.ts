import { Effect, Option, Predicate, Schema } from "effect";
import { Command, Render } from "foldkit";
import { UrlRequest, load } from "foldkit/navigation";
import type { Url } from "foldkit/url";
import { toString as urlToString } from "foldkit/url";

import {
  CalendarRoute,
  Route,
  ShortcutSection,
  isDocumentRoute,
  parseRoute,
  printRoute,
} from "../layout/route.js";
import { Message } from "./message.js";

const HistoryEntry = Schema.TaggedStruct("CalendarRouteHistory", {
  position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export const routeFromUrl = (url: Url) =>
  parseRoute(
    url.pathname,
    Option.getOrElse(url.search, () => ""),
    Option.getOrElse(url.hash, () => "")
  );

export const historyPosition = (): number =>
  Option.match(Schema.decodeUnknownOption(HistoryEntry)(window.history.state), {
    onNone: () => 0,
    onSome: (entry) => entry.position,
  });

const commitRoute = (route: typeof Route.Type, replace: boolean) =>
  Effect.sync(() => {
    const href = printRoute(route);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const position = historyPosition();

    const replacing =
      replace ||
      href === current ||
      (Predicate.isTagged(route, "Shortcuts") &&
        window.location.pathname === "/shortcuts");

    const state = HistoryEntry.make({
      position: replacing ? position : position + 1,
    });

    const write = replacing
      ? window.history.replaceState.bind(window.history)
      : window.history.pushState.bind(window.history);

    write(state, "", href);

    window.dispatchEvent(new PopStateEvent("popstate", { state }));
  });

export const InitializeRouteHistory = Command.define("InitializeRouteHistory", {
  execute: Effect.sync(() => {
    window.history.replaceState(
      HistoryEntry.make({ position: 0 }),
      "",
      window.location.href
    );

    return Message.Navigated();
  }),
  messages: [Message.Navigated],
});

export const NavigateRoute = Command.define("NavigateRoute", {
  args: { replace: Schema.Boolean, route: Route },
  execute: ({ route, replace }) =>
    commitRoute(route, replace).pipe(Effect.as(Message.Navigated())),
  messages: [Message.Navigated],
});

export const FollowRouteRequest = Command.define("FollowRouteRequest", {
  args: { request: UrlRequest },
  execute: ({ request }) =>
    UrlRequest.match(request, {
      External: ({ href }) => load(href),
      Internal: ({ url }) =>
        isDocumentRoute(url.pathname)
          ? commitRoute(routeFromUrl(url), false)
          : load(urlToString(url)),
    }).pipe(Effect.as(Message.Navigated())),
  messages: [Message.Navigated],
});

export const BackRoute = Command.define("BackRoute", {
  execute: Effect.gen(function* backRoute() {
    yield* historyPosition() > 0
      ? Effect.sync(() => {
          window.history.back();
        })
      : commitRoute(CalendarRoute.make({}), true);

    return Message.Navigated();
  }),
  messages: [Message.Navigated],
});

export const ScrollShortcutSection = Command.define("ScrollShortcutSection", {
  args: { section: ShortcutSection },
  execute: ({ section }) =>
    Render.afterCommit.pipe(
      Effect.andThen(
        Effect.sync(() => {
          document
            .querySelector(`#${section}`)
            ?.scrollIntoView({ block: "start" });

          return Message.Navigated();
        })
      )
    ),
  messages: [Message.Navigated],
});

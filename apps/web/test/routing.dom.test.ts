import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Option, Stream } from "effect";
import { fromString } from "foldkit/url";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import type { AppMessage } from "../src/client/app.js";
import { EditingRuntime } from "../src/client/editing/runtime.js";
import {
  InitializeRouteHistory,
  ScrollShortcutSection,
  historyPosition,
} from "../src/client/routing.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import { syncSearchRoute } from "../src/client/search/update.js";
import {
  CalendarRoute,
  SearchRoute,
  SettingsRoute,
  ShortcutsRoute,
  parseRoute,
} from "../src/layout/route.js";
import { unusedClipboardLayer } from "./clipboard-unused-fixture.js";
import { keyboardFixture } from "./keyboard-fixture.js";
import { unexpectedSearchClient } from "./search-fixture.js";

const execute = (result: ReturnType<typeof update>) =>
  Effect.forEach(result.commands ?? [], (command) => command.effect, {
    discard: true,
  }).pipe(
    Effect.provide(unusedClipboardLayer),
    Effect.provideService(CalendarSearchClient, unexpectedSearchClient),
    Effect.provideService(
      EditingRuntime,
      EditingRuntime.of({
        connect: () => Effect.succeed(Stream.empty),
        dispatch: () => Effect.void,
      })
    )
  );

const currentUrl = () => Option.getOrThrow(fromString(window.location.href));

const historyFixture = Effect.fn("test.historyFixture")(
  function* historyFixture(path: string) {
    window.history.replaceState(null, "", path);
    yield* InitializeRouteHistory().effect;

    let model = syncSearchRoute(
      keyboardFixture(),
      parseRoute(
        window.location.pathname,
        window.location.search,
        window.location.hash
      )
    );

    const receive = () => {
      const { model: next } = update(
        model,
        Message.BrowserUrlChanged({ url: currentUrl() })
      );

      model = next;
    };

    window.addEventListener("popstate", receive);
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        window.removeEventListener("popstate", receive);
        window.history.replaceState(null, "", "/");
      })
    );

    return {
      dispatch: Effect.fn("test.routeDispatch")(function* routeDispatch(
        message: AppMessage
      ) {
        const result = update(model, message);
        const { model: next } = result;
        model = next;
        yield* execute(result);
      }),
      get: () => model,
    };
  }
);

const nextPop = Stream.fromEventListener<PopStateEvent>(
  window,
  "popstate"
).pipe(Stream.take(1), Stream.runDrain);

it.effect(
  "question mark pushes shortcuts and Escape restores the prior search route without a dialog",
  () =>
    Effect.gen(function* searchBack() {
      const history = yield* historyFixture("/search?q=team");
      const before = history.get().calendar;
      yield* history.dispatch(
        Message.PressedCalendarKey({
          alt: false,
          key: "?",
          mod: false,
          now: 0,
          shift: true,
        })
      );
      expect(window.location.pathname).toBe("/shortcuts");
      expect(historyPosition()).toBe(1);
      expect(history.get().route).toEqual(
        ShortcutsRoute.make({ section: Option.none() })
      );
      expect(history.get().calendar).toBe(before);

      const popped = yield* nextPop.pipe(
        Effect.forkChild({ startImmediately: true })
      );

      yield* history.dispatch(
        Message.PressedCalendarKey({
          alt: false,
          key: "Escape",
          mod: false,
          now: 1,
          shift: false,
        })
      );
      expect(history.get().route).not.toEqual(CalendarRoute.make({}));
      yield* Fiber.join(popped);
      expect(history.get().route).toEqual(SearchRoute.make({ q: "team" }));
      expect(history.get().keyboard.screen).toBe("closed");
      expect(history.get().calendar).toBe(before);
    })
);

it.effect(
  "shortcuts opened from settings closes command state before navigation and Back preserves settings",
  () =>
    Effect.gen(function* settingsBack() {
      const history = yield* historyFixture("/settings/calendars");
      yield* history.dispatch(Message.KeyboardAction({ id: "commands" }));
      expect(history.get().keyboard.screen).toBe("commands");
      yield* history.dispatch(Message.KeyboardAction({ id: "shortcuts" }));
      expect(history.get().keyboard.screen).toBe("closed");

      const popped = yield* nextPop.pipe(
        Effect.forkChild({ startImmediately: true })
      );

      yield* history.dispatch(Message.KeyboardClose());
      yield* Fiber.join(popped);
      expect(history.get().route).toEqual(
        SettingsRoute.make({ page: "calendars" })
      );
      expect(history.get().keyboard.screen).toBe("closed");
    })
);

it.effect(
  "a directly loaded shortcuts page replaces to Calendar rather than leaving the app",
  () =>
    Effect.gen(function* directBack() {
      const history = yield* historyFixture("/shortcuts");
      expect(historyPosition()).toBe(0);
      yield* history.dispatch(Message.KeyboardClose());
      expect(window.location.pathname).toBe("/");
      expect(history.get().route).toEqual(CalendarRoute.make({}));
      expect(historyPosition()).toBe(0);
    })
);

it.effect(
  "settings Escape replaces Calendar without changing the saved grid view",
  () =>
    Effect.gen(function* settingsEscape() {
      const history = yield* historyFixture("/settings/general");
      const before = history.get().calendar;
      yield* history.dispatch(
        Message.PressedCalendarKey({
          alt: false,
          key: "Escape",
          mod: false,
          now: 0,
          shift: false,
        })
      );
      expect(window.location.pathname).toBe("/");
      expect(history.get().route).toEqual(CalendarRoute.make({}));
      expect(history.get().calendar).toBe(before);
      expect(historyPosition()).toBe(0);
    })
);

it.effect(
  "shortcut hashes scroll to their section after commit without creating another history level",
  () =>
    Effect.gen(function* sectionScroll() {
      const history = yield* historyFixture("/search?q=work");
      yield* history.dispatch(Message.KeyboardAction({ id: "shortcuts" }));
      const section = document.createElement("section");
      section.id = "calendar-navigation";
      const scroll = vi.fn<HTMLElement["scrollIntoView"]>();
      section.scrollIntoView = scroll;
      document.body.append(section);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          section.remove();
        })
      );
      yield* history.dispatch(
        Message.RequestedRoute({
          replace: false,
          route: ShortcutsRoute.make({
            section: Option.some("calendar-navigation"),
          }),
        })
      );
      yield* ScrollShortcutSection({ section: "calendar-navigation" }).effect;
      expect(historyPosition()).toBe(1);
      expect(window.location.hash).toBe("#calendar-navigation");
      expect(scroll).toHaveBeenCalledWith({ block: "start" });
    })
);

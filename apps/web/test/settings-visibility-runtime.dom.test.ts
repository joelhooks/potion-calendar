import {
  listEventsContract,
  setCalendarAppearanceContract,
} from "@calendar/calendar/contracts";
import { implement } from "@calendar/capability/implement";
import { toRpc } from "@calendar/capability/rpc";
import { expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Schema, pipe } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";

import { Message, update } from "../src/client/app.js";
import { calendarKey } from "../src/client/calendar-state.js";
import { ReadPreferences } from "../src/client/commands.js";
import { EditingRuntime } from "../src/client/editing/runtime.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import {
  SavedPreferences,
  StoredPreferences,
} from "../src/client/settings/model.js";
import { preferenceSnapshot } from "../src/client/settings/update.js";
import { unusedClipboardLayer } from "./clipboard-unused-fixture.js";
import { fixtureIndex, fixtureModel } from "./fixture.js";

const noEditing = EditingRuntime.of({
  connect: () => Effect.die("Unexpected editing connection"),
  dispatch: () => Effect.die("Unexpected editing dispatch"),
});

const noSearch = CalendarSearchClient.of({
  prefetch: () => Effect.die("Unexpected search prefetch"),
  search: () => Effect.die("Unexpected search request"),
});

it.effect(
  "the actual local visibility action executes its commands, stores an explicit override and makes zero provider appearance writes",
  () =>
    Effect.gen(function* localVisibility() {
      localStorage.clear();
      let writes = 0;
      const base = fixtureModel();

      const calendar = base.calendar.calendars.find(
        (entry) => entry.accountId === "work" && entry.calendarId === "primary"
      );

      if (calendar === undefined) {
        return yield* Effect.die(new Error("Expected work calendar"));
      }

      const rpc = toRpc([
        implement(listEventsContract, () =>
          Effect.succeed({ events: [], versions: [] })
        ),
        implement(setCalendarAppearanceContract, () =>
          Effect.sync(() => {
            writes += 1;

            return calendar;
          })
        ),
      ]);

      const backend = yield* Effect.acquireRelease(
        Effect.sync(() =>
          HttpRouter.toWebHandler(
            RpcServer.layerHttp({
              group: rpc.group,
              path: "/rpc",
              protocol: "http",
            }).pipe(
              Layer.provide(rpc.layer),
              Layer.provide(RpcSerialization.layerJson)
            ),
            { disableLogger: true }
          )
        ),
        (handler) => Effect.promise(handler.dispose.bind(handler))
      );

      // @effect-diagnostics-next-line asyncFunction:off -- Native Fetch requires a Promise adapter into the in-memory RPC handler.
      const fetcher: typeof fetch = async (input, init) =>
        await backend.handler(
          new Request(
            input instanceof Request
              ? input
              : new URL(input, "http://calendar.test"),
            init
          )
        );

      const changed = update(
        base,
        Message.ClickedCalendar({ accountId: "work", calendarId: "primary" })
      );

      yield* pipe(
        changed.commands ?? [],
        Effect.forEach((command) => command.effect),
        Effect.provide(unusedClipboardLayer),
        Effect.provideService(FetchHttpClient.Fetch, fetcher),
        Effect.provideService(EditingRuntime, noEditing),
        Effect.provideService(CalendarSearchClient, noSearch)
      );
      expect(writes).toBe(0);
      const key = calendarKey("work", "primary");
      expect(changed.model.calendar.visibility[key]).toBe(false);
      expect(changed.model.calendar.hidden).toContain(key);

      const stored = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(StoredPreferences)
      )(localStorage.getItem("calendar.visibility.fixture-person"));

      expect(stored).toMatchObject({
        version: 2,
        visibility: { [key]: false },
      });
      expect(Object.hasOwn(stored, "hidden")).toBe(false);
      localStorage.clear();

      return yield* Effect.void;
    })
);

it.effect(
  "the valid legacy-read path saves version two locally and preserves the already-visible set across its inventory baseline",
  () =>
    Effect.gen(function* legacyRead() {
      localStorage.clear();
      const base = fixtureModel();
      const person = Option.getOrThrow(base.person);
      const hidden = [calendarKey("work", "hidden")];
      localStorage.setItem(
        `calendar.visibility.${person}`,
        JSON.stringify({ hidden, theme: "dark", timeFormat: "24", version: 1 })
      );
      const result = update(base, yield* ReadPreferences({ person }).effect);
      expect(result.model.calendar.hidden).toEqual(hidden);

      const saves =
        result.commands?.filter(
          (command) => command.name === "SavePreferences"
        ) ?? [];

      expect(saves).toHaveLength(1);
      yield* pipe(
        saves,
        Effect.forEach((command) => command.effect),
        Effect.provide(unusedClipboardLayer),
        Effect.provideService(EditingRuntime, noEditing),
        Effect.provideService(CalendarSearchClient, noSearch)
      );

      const stored = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(SavedPreferences)
      )(localStorage.getItem(`calendar.visibility.${person}`));

      expect(stored.version).toBe(2);
      expect(stored.visibility[hidden[0] ?? ""]).toBe(false);
      expect(stored.timeFormat).toBe("24");

      const received = update(
        result.model,
        Message.ReceivedCalendars({ personId: person, result: fixtureIndex })
      );

      expect(received.model.calendar.hidden).toEqual(hidden);
      expect(preferenceSnapshot(received.model).visibility).toEqual(
        stored.visibility
      );
      localStorage.clear();
    })
);

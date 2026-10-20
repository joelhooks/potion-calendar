import * as BrowserStream from "@effect/platform-browser/BrowserStream";
import { Clock, Effect, Option, Predicate, Schema, Stream } from "effect";
import { Subscription } from "foldkit";

import { Model } from "./app.js";
import type { AppModel } from "./app.js";
import { EditingRuntime } from "./editing/runtime.js";
import { keyboardStream } from "./keyboard/subscription.js";
import { liveSocketStream } from "./live/socket.js";
import { Message } from "./message.js";
import type { AppMessage } from "./message.js";
import { reminderNotificationStream } from "./reminders/subscription.js";
import { searchInteractions } from "./search/browser.js";
import { SearchTask } from "./search/model.js";
import { SearchRuntime } from "./search/runtime.js";
import { systemSettingsStream } from "./settings/system.js";
import { UpcomingQuery } from "./upcoming/model.js";
import { upcomingStream } from "./upcoming/read.js";

export const subscriptions = Subscription.make<
  AppModel,
  AppMessage,
  EditingRuntime | SearchRuntime
>()((entry) => ({
  calendarChanges: Subscription.persistentEntry(
    Stream.suspend(() =>
      Stream.fromEventListener<Event>(window, "calendar-changed").pipe(
        Stream.map(() => Message.CalendarChanged())
      )
    )
  ),
  editing: entry(
    { person: Schema.Option(Schema.String) },
    {
      dependenciesToStream: ({ person }) =>
        Option.match(person, {
          onNone: () => Stream.empty,
          onSome: (personId) =>
            Stream.unwrap(
              EditingRuntime.use((runtime) => runtime.connect(personId)).pipe(
                Effect.map((notices) =>
                  notices.pipe(
                    Stream.map((notice) =>
                      Message.ReceivedEditing({ notice, personId })
                    )
                  )
                )
              )
            ),
        }),
      modelToDependencies: (model) => ({ person: model.person }),
    }
  ),
  keyboard: entry(
    { model: Model },
    {
      dependenciesToStream: ({ model }) => keyboardStream(model),
      modelToDependencies: (model) => ({ model }),
    }
  ),
  live: entry(
    { person: Schema.Option(Schema.String) },
    {
      dependenciesToStream: ({ person }) =>
        Option.match(person, {
          onNone: () => Stream.empty,
          onSome: (personId) =>
            liveSocketStream().pipe(
              Stream.map((notice) => Message.ReceivedLive({ notice, personId }))
            ),
        }),
      modelToDependencies: (model) => ({ person: model.person }),
    }
  ),
  minuteClock: Subscription.persistentEntry(
    Stream.fromEffectRepeat(
      Effect.gen(function* minuteTick() {
        const now = yield* Clock.currentTimeMillis;
        yield* Effect.sleep(60_000 - (now % 60_000));

        return Message.Ticked({ now: yield* Clock.currentTimeMillis });
      })
    )
  ),
  pageHidden: Subscription.persistentEntry(
    Stream.suspend(() =>
      BrowserStream.fromEventListenerWindow("pagehide").pipe(
        Stream.map(() => Message.PageHidden())
      )
    )
  ),
  reminders: entry(
    { person: Schema.Option(Schema.String) },
    {
      dependenciesToStream: ({ person }) =>
        Option.match(person, {
          onNone: () => Stream.empty,
          onSome: reminderNotificationStream,
        }),
      modelToDependencies: (model) => ({ person: model.person }),
    }
  ),
  search: entry(
    { task: Schema.Option(SearchTask) },
    {
      dependenciesToStream: ({ task }) =>
        Option.match(task, {
          onNone: () => Stream.empty,
          onSome: (input) =>
            Stream.unwrap(
              SearchRuntime.use((runtime) =>
                Effect.succeed(runtime.observe(input))
              )
            ).pipe(Stream.map((notice) => Message.ReceivedSearch({ notice }))),
        }),
      modelToDependencies: (model) => ({
        task:
          Option.isSome(model.person) &&
          Predicate.isTagged(model.route, "Search")
            ? Option.some({
                personId: model.person.value,
                request: {
                  query: model.search.text,
                  timeZone: model.calendar.zone,
                  weekStartsOn: Schema.decodeUnknownSync(
                    SearchTask.fields.request.fields.weekStartsOn
                  )(model.calendar.navigation.weekStartsOn ?? 0),
                },
                revision: model.search.revision,
              })
            : Option.none(),
      }),
    }
  ),
  searchInteractions: entry(
    { active: Schema.Boolean },
    {
      dependenciesToStream: ({ active }) =>
        active ? searchInteractions() : Stream.empty,
      modelToDependencies: (model) => ({
        active:
          Option.isSome(model.person) &&
          Predicate.isTagged(model.route, "Search"),
      }),
    }
  ),
  systemSettings: Subscription.persistentEntry(systemSettingsStream()),
  upcoming: entry(
    { query: Schema.Option(UpcomingQuery) },
    {
      dependenciesToStream: ({ query }) => upcomingStream(query),
      modelToDependencies: (model) => ({ query: model.upcoming.query }),
    }
  ),
  viewport: Subscription.persistentEntry(
    Stream.suspend(() =>
      BrowserStream.fromEventListenerWindow("resize").pipe(
        Stream.map(() => {
          const grid = document.querySelector(".calendar-view");
          const viewport = grid?.querySelector<HTMLElement>("#time-viewport");

          const gutter =
            viewport === undefined || viewport === null
              ? 0
              : viewport.offsetWidth - viewport.clientWidth;

          return Message.MeasuredViewport({
            gutter,
            height: grid?.clientHeight ?? Math.max(0, window.innerHeight - 56),
            width: (grid?.clientWidth ?? window.innerWidth) - gutter,
          });
        })
      )
    )
  ),
}));

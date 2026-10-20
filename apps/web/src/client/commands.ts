import { CalendarRef, Range } from "@calendar/calendar/contracts";
import { Effect, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http";
import { RpcClient } from "effect/rpc";
import { Command, Render } from "foldkit";

import { initialScroll } from "../layout/geometry.js";
import { timeAreaHeight, todayScrollLeft } from "../layout/grid-geometry.js";
import { readFailure } from "./calendar-state.js";
import { Message } from "./message.js";
import { browserGroup, protocol } from "./rpc.js";
import {
  StoredPreferences,
  SavedPreferences,
  normalizePreferences,
} from "./settings/model.js";

export { browserGroup } from "./rpc.js";

export const ReadSession = Command.define("ReadSession", {
  execute: Effect.gen(function* readSession() {
    const client = yield* RpcClient.make(browserGroup);

    return Message.ReceivedSession({ snapshot: yield* client.session({}) });
  }).pipe(
    Effect.provide(protocol),
    Effect.scoped,
    Effect.orElseSucceed(() => Message.FailedSession())
  ),
  messages: [Message.ReceivedSession, Message.FailedSession],
});

export const ReadCalendars = Command.define("ReadCalendars", {
  args: { personId: Schema.String },
  execute: ({ personId }) =>
    Effect.gen(function* readCalendars() {
      const client = yield* RpcClient.make(browserGroup);

      return Message.ReceivedCalendars({
        personId,
        result: yield* client.listCalendars({}),
      });
    }).pipe(
      Effect.provide(protocol),
      Effect.scoped,
      Effect.match({
        onFailure: (error) =>
          Message.FailedCalendars({ failure: readFailure(error), personId }),
        onSuccess: (message) => message,
      })
    ),
  messages: [Message.ReceivedCalendars, Message.FailedCalendars],
});

export const ReadEvents = Command.define("ReadEvents", {
  args: {
    accountId: Schema.String,
    calendars: Schema.Array(CalendarRef),
    range: Range,
    request: Schema.Int,
  },
  execute: ({ accountId, calendars, range, request }) =>
    Effect.gen(function* readEvents() {
      const client = yield* RpcClient.make(browserGroup);

      return Message.ReceivedEvents({
        accountId,
        request,
        result: yield* client.listEvents({ calendars, range }),
      });
    }).pipe(
      Effect.provide(protocol),
      Effect.scoped,
      Effect.match({
        onFailure: (error) =>
          Message.FailedEvents({
            accountId,
            failure: readFailure(error),
            request,
          }),
        onSuccess: (message) => message,
      })
    ),
  messages: [Message.ReceivedEvents, Message.FailedEvents],
});

const preferenceKey = (person: string): string =>
  `calendar.visibility.${person}`;

export const ReadPreferences = Command.define("ReadPreferences", {
  args: { person: Schema.String },
  execute: ({ person }) =>
    Effect.try(
      () =>
        localStorage.getItem(preferenceKey(person)) ??
        '{"version":2,"visibility":{}}'
    ).pipe(
      Effect.flatMap(
        Schema.decodeEffect(Schema.fromJsonString(StoredPreferences))
      ),
      Effect.map((stored) =>
        Message.ReceivedPreferences({
          person,
          preferences: normalizePreferences(stored),
        })
      ),
      Effect.orElseSucceed(() => Message.FailedPreferences({ person }))
    ),
  messages: [Message.ReceivedPreferences, Message.FailedPreferences],
});

export const SavePreferences = Command.define("SavePreferences", {
  args: { ...SavedPreferences.fields, person: Schema.String },
  execute: ({ person, ...preferences }) =>
    Schema.encodeEffect(Schema.fromJsonString(SavedPreferences))(
      preferences
    ).pipe(
      Effect.flatMap((encoded) =>
        Effect.try(() => {
          localStorage.setItem(preferenceKey(person), encoded);
        })
      ),
      Effect.as(Message.SavedPreferences()),
      Effect.orElseSucceed(() => Message.FailedPreferenceSave({ person }))
    ),
  messages: [Message.SavedPreferences, Message.FailedPreferenceSave],
});

export const ScrollToNow = Command.define("ScrollToNow", {
  args: { minute: Schema.Finite, scale: Schema.Finite },
  execute: ({ minute, scale }) =>
    Render.afterCommit.pipe(
      Effect.andThen(
        Effect.sync(() => {
          const viewport =
            document.querySelector<HTMLElement>("#time-viewport");

          if (viewport !== null) {
            viewport.scrollTop = initialScroll(
              minute,
              scale,
              timeAreaHeight(viewport)
            );
            viewport.scrollLeft = todayScrollLeft(viewport);
          }

          return Message.CompletedGridScroll();
        })
      )
    ),
  messages: [Message.CompletedGridScroll],
});

export const PreserveTimePosition = Command.define("PreserveTimePosition", {
  args: { offset: Schema.Finite },
  execute: ({ offset }) =>
    Render.afterCommit.pipe(
      Effect.andThen(
        Effect.sync(() => {
          const viewport = document.querySelector("#time-viewport");

          if (viewport !== null) {
            viewport.scrollTop += offset;
          }

          return Message.CompletedGridScroll();
        })
      )
    ),
  messages: [Message.CompletedGridScroll],
});

export const BeginGoogle = Command.define("BeginGoogle", {
  args: { linking: Schema.Boolean },
  execute: ({ linking }) =>
    Effect.gen(function* beginGoogle() {
      const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);

      const response = yield* client.execute(
        HttpClientRequest.post(
          linking ? "/auth/oauth2/link" : "/auth/sign-in/oauth2"
        ).pipe(
          HttpClientRequest.bodyJsonUnsafe({
            callbackURL: "/",
            errorCallbackURL: "/refused",
            providerId: "google",
          })
        )
      );

      const redirect = yield* HttpClientResponse.schemaBodyJson(
        Schema.Struct({ url: Schema.String })
      )(response);

      yield* Effect.sync(() => {
        window.location.assign(redirect.url);
      });

      return Message.Navigated();
    }).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.orElseSucceed(() => Message.FailedAuth())
    ),
  messages: [Message.Navigated, Message.FailedAuth],
});

export const SignOut = Command.define("SignOut", {
  execute: Effect.gen(function* signOut() {
    const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
    yield* client.execute(
      HttpClientRequest.post("/auth/sign-out").pipe(
        HttpClientRequest.bodyJsonUnsafe({})
      )
    );
    yield* Effect.sync(() => {
      window.location.reload();
    });

    return Message.Navigated();
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.orElseSucceed(() => Message.FailedAuth())
  ),
  messages: [Message.Navigated, Message.FailedAuth],
});

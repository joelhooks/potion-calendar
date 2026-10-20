import {
  CalendarRef,
  Range,
  listCalendarsContract,
  listEventsContract,
} from "@calendar/calendar/contracts";
import { toRpcGroup } from "@calendar/capability/rpc-group";
import { sessionContract } from "@calendar/core/contracts";
import { Effect, Layer, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Command, Render } from "foldkit";

import { initialScroll } from "../layout/geometry.js";
import { Preferences, readFailure } from "./calendar-state.js";
import { Message } from "./message.js";

export const browserGroup = toRpcGroup([
  sessionContract,
  listCalendarsContract,
  listEventsContract,
]).group;

const protocol = RpcClient.layerProtocolHttp({ url: "/rpc" }).pipe(
  Layer.provide(RpcSerialization.layerJson),
  Layer.provide(FetchHttpClient.layer)
);

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
  execute: Effect.gen(function* readCalendars() {
    const client = yield* RpcClient.make(browserGroup);

    return Message.ReceivedCalendars({
      result: yield* client.listCalendars({}),
    });
  }).pipe(
    Effect.provide(protocol),
    Effect.scoped,
    Effect.match({
      onFailure: (error) =>
        Message.FailedCalendars({ failure: readFailure(error) }),
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
      () => localStorage.getItem(preferenceKey(person)) ?? '{"hidden":[]}'
    ).pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(Schema.fromJsonString(Preferences))
      ),
      Effect.map(({ hidden, mergeDuplicates }) =>
        Message.ReceivedPreferences({
          hidden,
          mergeDuplicates: mergeDuplicates ?? true,
        })
      ),
      Effect.orElseSucceed(() => Message.FailedPreferences())
    ),
  messages: [Message.ReceivedPreferences, Message.FailedPreferences],
});

export const SavePreferences = Command.define("SavePreferences", {
  args: {
    hidden: Schema.Array(Schema.String),
    mergeDuplicates: Schema.Boolean,
    person: Schema.String,
  },
  execute: ({ hidden, mergeDuplicates, person }) =>
    Effect.try(() => {
      localStorage.setItem(
        preferenceKey(person),
        JSON.stringify({ hidden, mergeDuplicates })
      );
    }).pipe(
      Effect.as(Message.SavedPreferences()),
      Effect.orElseSucceed(() => Message.FailedPreferences())
    ),
  messages: [Message.SavedPreferences, Message.FailedPreferences],
});

export const ScrollToNow = Command.define("ScrollToNow", {
  args: { minute: Schema.Finite, scale: Schema.Finite },
  execute: ({ minute, scale }) =>
    Render.afterCommit.pipe(
      Effect.andThen(
        Effect.sync(() => {
          const viewport = document.querySelector("#time-viewport");

          if (viewport !== null) {
            viewport.scrollTop = initialScroll(
              minute,
              scale,
              viewport.clientHeight
            );
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

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

import { gridGeometry, initialScroll } from "../layout/geometry.js";
import { timeAreaHeight, todayScrollLeft } from "../layout/grid-geometry.js";
import { MinuteRange } from "../layout/time-blocks.js";
import { readFailure } from "./calendar-state.js";
import { canResumeHost } from "./grid-resume/host.js";
import { Message } from "./message.js";
import { browserGroup, protocol } from "./rpc.js";
import { SavedPreferences } from "./settings/model.js";
import {
  readPreferences,
  writeGeneralPreferences,
} from "./settings/preference-storage.js";

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

export const ReadPreferences = Command.define("ReadPreferences", {
  args: { person: Schema.String },
  execute: ({ person }) =>
    readPreferences(person).pipe(
      Effect.map((preferences) =>
        Message.ReceivedPreferences({ person, preferences })
      ),
      Effect.orElseSucceed(() => Message.FailedPreferences({ person }))
    ),
  messages: [Message.ReceivedPreferences, Message.FailedPreferences],
});

export const SavePreferences = Command.define("SavePreferences", {
  args: { ...SavedPreferences.fields, person: Schema.String },
  execute: ({ person, ...preferences }) =>
    writeGeneralPreferences(person, preferences).pipe(
      Effect.as(Message.SavedPreferences()),
      Effect.orElseSucceed(() => Message.FailedPreferenceSave({ person }))
    ),
  messages: [Message.SavedPreferences, Message.FailedPreferenceSave],
});

export const ScrollToNow = Command.define("ScrollToNow", {
  args: {
    hidden: Schema.optionalKey(Schema.Array(MinuteRange)),
    minute: Schema.Finite,
    resume: Schema.optionalKey(
      Schema.Struct({ day: Schema.Finite, hostKey: Schema.String })
    ),
    scale: Schema.Finite,
  },
  execute: ({ hidden, minute, resume, scale }) =>
    Render.afterCommit.pipe(
      Effect.andThen(
        Effect.sync(() => {
          if (resume !== undefined && !canResumeHost(document, resume)) {
            return Message.CompletedGridScroll();
          }

          const viewport =
            document.querySelector<HTMLElement>("#time-viewport");

          if (viewport !== null) {
            viewport.scrollTop = initialScroll(
              minute,
              scale,
              timeAreaHeight(viewport),
              gridGeometry(scale, hidden)
            );
            viewport.scrollLeft = todayScrollLeft(viewport);
          }

          return Message.CompletedGridScroll();
        })
      )
    ),
  messages: [Message.CompletedGridScroll],
});

export const ScrollSelectionArgs = Schema.Struct({
  allDay: Schema.Boolean,
  hidden: Schema.Array(MinuteRange),
  key: Schema.String,
  minute: Schema.Finite,
  scale: Schema.Finite,
});

export const ScrollToSelection = Command.define("ScrollToSelection", {
  args: ScrollSelectionArgs.fields,
  execute: ({ allDay, hidden, key, minute, scale }) =>
    Render.afterCommit.pipe(
      Effect.andThen(
        Effect.sync(() => {
          const viewport =
            document.querySelector<HTMLElement>("#time-viewport");

          const target = [
            ...document.querySelectorAll<HTMLElement>("[data-event-key]"),
          ].find(
            (element) =>
              element.dataset.eventKey === key &&
              element.classList.contains("selected")
          );

          if (viewport !== null && target !== undefined) {
            if (!allDay) {
              viewport.scrollTop = initialScroll(
                minute,
                scale,
                timeAreaHeight(viewport),
                gridGeometry(scale, hidden)
              );
            }

            const area = viewport.getBoundingClientRect();
            const event = target.getBoundingClientRect();

            if (event.left < area.left) {
              viewport.scrollLeft += event.left - area.left;
            } else if (event.right > area.right) {
              viewport.scrollLeft += event.right - area.right;
            }
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

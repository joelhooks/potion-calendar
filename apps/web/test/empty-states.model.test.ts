import { expect, it } from "@effect/vitest";
import { Effect, Match, Option, Schema } from "effect";
import { AsyncData } from "foldkit";

import { Message, update } from "../src/client/app.js";
import { calendarKey, RemoteEvents } from "../src/client/calendar-state.js";
import { calendarReadFailures } from "../src/layout/calendar-read-state.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { emptyStateFixture, retryFailure } from "./empty-states-fixture.js";

it.effect.prop(
  "refresh histories keep cached week chips and one notice per calendar until a successful read",
  {
    history: Schema.Array(
      Schema.Literals(["retry", "fail", "success", "stale-response"])
    ).check(Schema.isMaxLength(40)),
  },
  ({ history }) =>
    Effect.sync(() => {
      let model = emptyStateFixture("upcoming-empty");

      const original = Option.getOrThrow(
        AsyncData.getData(
          model.calendar.reads[0]?.events ?? RemoteEvents.Idle()
        )
      );

      const chips = visibleEvents(model).map((event) => event.key);
      let failed = false;

      for (const action of history) {
        const current = model;
        const request = current.calendar.rangeRequest;

        const result = Match.value(action).pipe(
          Match.when("retry", () => update(current, Message.ClickedRefresh())),
          Match.when("success", () =>
            update(
              current,
              Message.ReceivedEvents({
                accountId: "work",
                request,
                result: original,
              })
            )
          ),
          Match.orElse(() =>
            update(
              current,
              Message.FailedEvents({
                accountId: "work",
                failure: retryFailure,
                request: action === "stale-response" ? request - 1 : request,
              })
            )
          )
        );

        if (action === "retry") {
          expect(result.commands?.map((command) => command.name)).toEqual([
            "RefreshEvents",
          ]);
        }

        if (action === "fail") {
          failed = true;
        }

        if (action === "success") {
          failed = false;
        }

        if (action === "stale-response") {
          expect(result.model).toBe(model);
        }

        ({ model } = result);
        expect(visibleEvents(model).map((event) => event.key)).toEqual(chips);
        expect(
          calendarReadFailures(model).map(({ cached, key }) => ({
            cached,
            key,
          }))
        ).toEqual(
          failed ? [{ cached: true, key: calendarKey("work", "primary") }] : []
        );
      }
    })
);

it.effect(
  "empty cached calendars are known from versions; uncached calendars are not inferred from another calendar's rows",
  () =>
    Effect.sync(() => {
      const base = emptyStateFixture("refresh-failed");
      const [read] = base.calendar.reads;
      const [calendar] = base.calendar.calendars;

      if (read === undefined || calendar === undefined) {
        throw new Error("Missing fixture calendar");
      }

      const result = Option.getOrThrow(AsyncData.getData(read.events));

      const model = {
        ...base,
        calendar: {
          ...base.calendar,
          calendars: [
            calendar,
            { ...calendar, calendarId: "unread", title: "Unread" },
            { ...calendar, calendarId: "empty", title: "Empty" },
          ],
          reads: [
            {
              ...read,
              events: RemoteEvents.Stale({
                data: {
                  ...result,
                  versions: [
                    ...result.versions,
                    { accountId: "work", calendarId: "empty", version: 2 },
                  ],
                },
                error: retryFailure,
              }),
            },
          ],
        },
      };

      expect(
        calendarReadFailures(model).map((failure) => [
          failure.calendar.title,
          failure.cached,
        ])
      ).toEqual([
        ["Work", true],
        ["Unread", false],
        ["Empty", true],
      ]);
      expect(
        calendarReadFailures({
          ...model,
          calendar: {
            ...model.calendar,
            hidden: [calendarKey("work", "primary")],
          },
        }).map((item) => item.calendar.title)
      ).toEqual(["Unread", "Empty"]);
      expect(
        calendarReadFailures({
          ...model,
          calendar: {
            ...model.calendar,
            reads: [
              {
                ...read,
                events: RemoteEvents.Stale({
                  data: result,
                  error: {
                    kind: "reconnect",
                    message: "Reconnect this Google account.",
                  },
                }),
              },
            ],
          },
        })
      ).toEqual([]);
    })
);

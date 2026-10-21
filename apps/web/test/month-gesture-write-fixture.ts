import { NodeServices } from "@effect/platform-node";
import { expect } from "@effect/vitest";
import { Effect, Layer, Option, Queue, Ref, Stream } from "effect";
import { FetchHttpClient } from "effect/http";
import { AsyncData } from "foldkit";

import {
  response,
  timedEvent,
} from "../../../packages/calendar/test/fake-google.js";
import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionWriter } from "../src/client/editing/delete-actor.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import {
  EditorRequest,
  EditorMutation,
} from "../src/client/editing/editor-session-model.js";
import {
  EditingCommand,
  EditingNotice,
  EditingRuntime,
} from "../src/client/editing/runtime.js";
import { dayFromIso } from "../src/layout/navigation.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { editingRpcFixture, writeBody } from "./editing-rpc-fixture.js";

export const saveMonthGestureThroughRpc = Effect.fn(
  "saveMonthGestureThroughRpc"
)(
  function* saveMonthGestureThroughRpc(
    model: AppModel,
    command: typeof EditingCommand.Type
  ) {
    const original = timedEvent("a-review", "Product review", {
      attendees: [
        { email: "owner@example.test", responseStatus: "accepted", self: true },
        { email: "guest@example.test", responseStatus: "accepted" },
      ],
      end: { dateTime: "2026-10-19T09:57:00-07:00" },
      organizer: { email: "owner@example.test", self: true },
      start: { dateTime: "2026-10-19T09:07:00-07:00" },
    });

    const moved = {
      ...original,
      end: { dateTime: "2026-10-20T09:57:00-07:00" },
      start: { dateTime: "2026-10-20T09:07:00-07:00" },
    };

    const duplicate =
      EditingCommand.guards.Open(command) &&
      EditorRequest.guards.Existing(command.request) &&
      command.request.mode === "duplicate";

    const api = yield* editingRpcFixture(
      duplicate
        ? [
            response(200, original),
            response(200, {
              ...moved,
              iCalUID: "month-copy@fake.test",
              id: "0123456789abcdef",
            }),
          ]
        : [
            response(200, original),
            response(200, original),
            response(200, moved),
          ]
    );

    const services = Layer.merge(
      CalendarEditingClient.layer("available"),
      Layer.succeed(
        DeletionWriter,
        DeletionWriter.of({
          commit: () => Effect.die("A month move must not delete an event"),
        })
      )
    );

    const context = yield* Layer.build(
      EditingRuntime.layer.pipe(Layer.provide(services))
    );

    const runtime = yield* Effect.service(EditingRuntime).pipe(
      Effect.provide(context)
    );

    const personId = Option.getOrThrow(model.person);
    let current = model;
    const queue = yield* Queue.unbounded<typeof EditingNotice.Type>();

    const notices = yield* runtime
      .connect(personId)
      .pipe(Effect.provideService(FetchHttpClient.Fetch, api.fetcher));

    yield* notices.pipe(
      Stream.runForEach((notice) =>
        Effect.sync(() => {
          current = update(
            current,
            Message.ReceivedEditing({ notice, personId })
          ).model;
        }).pipe(Effect.andThen(Queue.offer(queue, notice)))
      ),
      Effect.forkScoped
    );

    const awaitNotice = (
      predicate: (notice: typeof EditingNotice.Type) => boolean
    ) =>
      Stream.fromQueue(queue).pipe(
        Stream.filter(predicate),
        Stream.runHead,
        Effect.map(Option.getOrThrow)
      );

    yield* runtime.dispatch(personId, command);
    yield* awaitNotice(
      (notice) =>
        EditingNotice.guards.Editor(notice) &&
        EditorView.guards.Email(notice.view)
    );
    yield* runtime.dispatch(
      personId,
      EditingCommand.cases.Action.make({
        action: EditorAction.cases.SendUpdates.make({ send: false }),
      })
    );

    const saved = yield* awaitNotice(
      (notice) =>
        EditingNotice.guards.Editor(notice) && Option.isSome(notice.mutation)
    );

    expect(
      EditingNotice.guards.Editor(saved) && Option.isSome(saved.mutation)
    ).toBe(true);
    const requests = yield* Ref.get(api.fake.requests);

    const writes = requests.filter(
      (request) => request.method === (duplicate ? "POST" : "PATCH")
    );

    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toContain(
      duplicate
        ? "/calendars/primary/events?"
        : "/calendars/primary/events/a-review"
    );
    expect(
      new URL(
        writes[0]?.path ?? "",
        "https://fixture.invalid"
      ).searchParams.get("sendUpdates")
    ).toBe("none");
    expect(writeBody(writes[0]?.body)).toMatchObject({
      end: { dateTime: "2026-10-20T16:57:00.000Z" },
      start: { dateTime: "2026-10-20T16:07:00.000Z" },
    });
    expect(current.calendar.selected).toEqual(model.calendar.selected);

    if (duplicate) {
      expect(writeBody(writes[0]?.body)).toMatchObject({
        summary: "Product review",
      });

      return { model: current, moved };
    }

    if (
      !EditingNotice.guards.Editor(saved) ||
      Option.isNone(saved.mutation) ||
      !EditorMutation.guards.Saved(saved.mutation.value)
    ) {
      throw new Error("Missing saved month mutation");
    }

    const { event } = saved.mutation.value;

    const read = model.calendar.reads.find(
      (entry) => entry.accountId === event.accountId
    );

    if (read === undefined) {
      throw new Error("Missing month account read");
    }

    const previous = Option.getOrThrow(AsyncData.getData(read.events));
    current = update(
      current,
      Message.ReceivedEvents({
        accountId: event.accountId,
        request: current.calendar.rangeRequest,
        result: {
          ...previous,
          events: previous.events.map((item) =>
            item.eventId === event.eventId ? event : item
          ),
        },
      })
    ).model;
    expect(current.calendar.selected).toEqual(model.calendar.selected);

    const movedItem = visibleEvents(current).find(
      (item) => item.source.eventId === "a-review"
    );

    expect(movedItem?.selected).toBe(true);
    expect(movedItem?.startDay).toBe(dayFromIso("2026-10-20"));

    for (const item of visibleEvents(model).filter(
      (candidate) =>
        candidate.selected && candidate.source.eventId !== "a-review"
    )) {
      expect(
        visibleEvents(current).find((candidate) => candidate.key === item.key)
          ?.source
      ).toEqual(item.source);
    }

    return { model: current, moved };
  },
  Effect.scoped,
  Effect.provide(NodeServices.layer)
);

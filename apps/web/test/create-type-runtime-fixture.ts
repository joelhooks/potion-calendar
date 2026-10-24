import { Calendar } from "@calendar/calendar/contracts";
import { Crypto, Effect, Layer, Option, Queue, Ref, Stream } from "effect";
import { FetchHttpClient } from "effect/http";
import { renderToString } from "foldkit/experimental/server";

import {
  ref,
  response,
  timedEvent,
} from "../../../packages/calendar/test/fake-google.js";
import { Message, RemoteSession, update } from "../src/client/app.js";
import type { AppMessage, AppModel } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionWriter } from "../src/client/editing/delete-actor.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import {
  EditingNotice,
  EditingRuntime,
} from "../src/client/editing/runtime.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import { view } from "../src/features/app.js";
import { unusedBrowserLayers } from "./browser-runtime-fixture.js";
import { editingRpcFixture } from "./editing-rpc-fixture.js";
import { fixtureModel } from "./fixture.js";
import { unexpectedSearchClient } from "./search-fixture.js";

export const typeScenes = [
  "event",
  "focus",
  "ooo",
  "ineligible",
  "refused",
] as const;

export type TypeScene = (typeof typeScenes)[number];

export const typeFixtureId = "01010101010141018101010101010101";

export const typeTitle = {
  event: "Planning session",
  focus: "Writing time",
  ineligible: "Team planning",
  ooo: "Out of office",
  refused: "Writing time",
};

export const nextTypeNotice = Effect.fn("nextTypeNotice")(
  function* nextTypeNotice(
    queue: Queue.Queue<typeof EditingNotice.Type>,
    predicate: (notice: typeof EditingNotice.cases.Editor.Type) => boolean
  ) {
    while (true) {
      const notice = yield* Queue.take(queue);

      if (EditingNotice.guards.Editor(notice) && predicate(notice)) {
        return notice;
      }
    }
  }
);

export const createTypeRuntimeFixture = Effect.fn("createTypeRuntimeFixture")(
  function* createTypeRuntimeFixture(scene: TypeScene, failStatus?: number) {
    const calendar = Calendar.make({
      ...ref,
      accessRole: "owner",
      defaultReminders: [],
      primary: scene !== "ineligible",
      timeZone: "America/Los_Angeles",
      title: scene === "ineligible" ? "Shared project" : "Work",
    });

    const eventType = scene === "ooo" ? "outOfOffice" : "focusTime";

    const saved = timedEvent(typeFixtureId, typeTitle[scene], {
      end: {
        dateTime:
          scene === "ooo"
            ? "2026-10-24T00:00:00.000Z"
            : "2026-10-21T17:00:00.000Z",
        timeZone: "America/Los_Angeles",
      },
      eventType: scene === "event" ? "default" : eventType,
      organizer: { self: true },
      start: {
        dateTime: "2026-10-21T16:00:00.000Z",
        timeZone: "America/Los_Angeles",
      },
    });

    const calendarReply = response(200, {
      accessRole: calendar.accessRole,
      defaultReminders: [],
      id: ref.calendarId,
      primary: calendar.primary,
      summary: calendar.title,
    });

    const insertReply =
      scene === "refused"
        ? response(failStatus ?? 403, {
            error: {
              errors: [{ reason: "forbidden" }],
              message: "Status insert refused",
            },
          })
        : response(200, saved);

    const api = yield* editingRpcFixture(
      scene === "ineligible"
        ? []
        : [...(scene === "event" ? [] : [calendarReply]), insertReply]
    );

    const clientLayer = CalendarEditingClient.layer("notAvailable").pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, api.fetcher))
    );

    const context = yield* Layer.build(
      EditingRuntime.layer.pipe(
        Layer.provide(clientLayer),
        Layer.provide(
          Layer.succeed(DeletionWriter, {
            commit: () => Effect.die("Unexpected deletion"),
          })
        )
      )
    ).pipe(
      Effect.provideService(
        Crypto.Crypto,
        Crypto.make({
          digest: () => Effect.die("Unexpected actor digest"),
          randomBytes: (size) => new Uint8Array(size).fill(1),
        })
      )
    );

    const runtime = yield* Effect.service(EditingRuntime).pipe(
      Effect.provide(context)
    );

    const base = fixtureModel();

    const model: AppModel = {
      ...base,
      calendar: {
        ...base.calendar,
        calendars: [calendar],
        hidden: [],
        reads: [
          {
            accountId: ref.accountId,
            events: RemoteEvents.Success({
              data: { events: [], versions: [] },
            }),
          },
        ],
        selected: [],
      },
      session: RemoteSession.Success({
        data: {
          accounts: [
            {
              disconnected: false,
              email: "owner@example.test",
              id: ref.accountId,
            },
          ],
          user: {
            email: "owner@example.test",
            id: "fixture-person",
            name: "Calendar owner",
          },
        },
      }),
    };

    const state = yield* Ref.make(model);
    const queue = yield* Queue.unbounded<typeof EditingNotice.Type>();
    const personId = Option.getOrThrow(model.person);

    const notices = yield* runtime
      .connect(personId)
      .pipe(Effect.provideService(FetchHttpClient.Fetch, api.fetcher));

    yield* notices.pipe(
      Stream.runForEach((notice) =>
        Ref.update(
          state,
          (current) =>
            update(current, Message.ReceivedEditing({ notice, personId })).model
        ).pipe(Effect.andThen(Queue.offer(queue, notice)))
      ),
      Effect.forkScoped
    );

    const dispatchMessage = Effect.fn("dispatchCreateTypeRoot")(
      function* dispatchMessage(message: AppMessage) {
        const result = update(yield* Ref.get(state), message);

        yield* Ref.set(state, result.model);

        for (const command of result.commands ?? []) {
          if (command.name === "DispatchEditing") {
            yield* command.effect.pipe(
              Effect.provide(unusedBrowserLayers),
              Effect.provideService(
                CalendarSearchClient,
                unexpectedSearchClient
              ),
              Effect.provideService(EditingRuntime, runtime)
            );
          }
        }
      }
    );

    const dispatch = (action: typeof EditorAction.Type) =>
      dispatchMessage(Message.EditingAction({ action }));

    const editText = Effect.fn("editCreateTypeText")(function* editText(
      field: "title" | "startDate" | "endDate" | "startTime" | "endTime",
      value: string
    ) {
      yield* dispatch(EditorAction.cases.TextEdited.make({ field, value }));
      yield* nextTypeNotice(
        queue,
        (notice) =>
          EditorView.guards.Editing(notice.view) &&
          notice.view.draft[field] === value
      );
    });

    yield* dispatch(EditorAction.cases.OpenCreate.make({}));
    yield* nextTypeNotice(queue, (notice) =>
      EditorView.guards.Editing(notice.view)
    );
    yield* editText("title", typeTitle[scene]);
    yield* editText("startDate", "2026-10-21");
    yield* editText("endDate", scene === "ooo" ? "2026-10-23" : "2026-10-21");
    yield* editText("startTime", "09:00");
    yield* editText("endTime", scene === "ooo" ? "17:00" : "10:00");

    if (scene !== "event" && scene !== "ineligible") {
      yield* dispatch(
        EditorAction.cases.EventTypeSelected.make({ value: eventType })
      );
      yield* nextTypeNotice(
        queue,
        (notice) =>
          EditorView.guards.Editing(notice.view) &&
          notice.view.draft.eventType === eventType
      );
    }

    return {
      api,
      calendar,
      calendarReply,
      dispatch,
      dispatchMessage,
      editText,
      model,
      queue,
      runtime,
      saved,
      state,
    };
  }
);

export const renderTypeRoot = (model: AppModel) =>
  renderToString({ init: () => ({ model }), view }, { isHydratable: false });

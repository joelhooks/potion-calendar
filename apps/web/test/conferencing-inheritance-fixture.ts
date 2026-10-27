import type { ConferencingDefault } from "@calendar/calendar/contracts";
import { NodeServices } from "@effect/platform-node";
import { expect } from "@effect/vitest";
import {
  Crypto,
  Effect,
  Layer,
  Option,
  Queue,
  Ref,
  Schema,
  Stream,
} from "effect";
import { FetchHttpClient } from "effect/http";
import { renderToString } from "foldkit/experimental/server";

import {
  response,
  timedEvent,
} from "../../../packages/calendar/test/fake-google.js";
import { Message, update } from "../src/client/app.js";
import type { AppMessage, AppModel } from "../src/client/app.js";
import { ReadPreferences } from "../src/client/commands.js";
import { RemoteConferencingDefault } from "../src/client/conferencing/model.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionWriter } from "../src/client/editing/delete-actor.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import {
  EditingCommand,
  EditingNotice,
  EditingRuntime,
} from "../src/client/editing/runtime.js";
import { SaveDefaultConferencing } from "../src/client/settings/conferencing/commands.js";
import { UserDefaultConferencing } from "../src/client/settings/conferencing/default.js";
import { view } from "../src/features/app.js";
import { CalendarRoute, SettingsRoute } from "../src/layout/route.js";
import { editingRpcFixture } from "./editing-rpc-fixture.js";
import { fixtureSelection } from "./fixture.js";

export const inheritanceWrite = Schema.Struct({
  personId: Schema.String,
  requestId: Schema.Int,
  value: UserDefaultConferencing,
});

export const persistInheritanceChoice = Effect.fn(
  "test.persistInheritanceChoice"
)(function* persistInheritanceChoice(result: ReturnType<typeof update>) {
  const command = result.commands?.find(
    (item) => item.name === SaveDefaultConferencing.name
  );

  expect(command, "root must emit the named persistence command").toBeDefined();

  const args = yield* Schema.decodeUnknownEffect(inheritanceWrite)(
    command?.args
  );

  return yield* SaveDefaultConferencing(args).effect;
});

export const inheritanceModel = Effect.fn("test.inheritanceModel")(
  function* inheritanceModel(
    user: typeof UserDefaultConferencing.Type,
    account: typeof ConferencingDefault.Type = "unset",
    capable?: boolean
  ) {
    const base = fixtureSelection();
    const person = Option.getOrThrow(base.person);
    const key = `calendar.visibility.${person}`;
    localStorage.setItem(
      key,
      JSON.stringify({ defaultConferencing: user, version: 2, visibility: {} })
    );
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        localStorage.removeItem(key);
      })
    );

    const loaded = update(
      base,
      yield* ReadPreferences({ person }).effect
    ).model;

    const model: AppModel = {
      ...loaded,
      calendar: {
        ...loaded.calendar,
        calendars: loaded.calendar.calendars.map((calendar) => ({
          ...calendar,
          allowedConferenceSolutionTypes:
            capable === false ? [] : ["hangoutsMeet"],
        })),
      },
      conferencing: {
        accounts: {
          work: {
            operation: "read",
            remote: RemoteConferencingDefault.Success({
              data: { accountId: "work", value: account },
            }),
            requestId: 1,
          },
        },
        nextRequestId: 1,
      },
      route: SettingsRoute.make({ page: "conferencing" }),
    };

    return model;
  }
);

export const renderInheritanceRoot = (model: AppModel) =>
  renderToString({ init: () => ({ model }), view }, { isHydratable: false });

export const inheritanceSession = Effect.fn("test.inheritanceSession")(
  function* inheritanceSession(model: AppModel) {
    const personId = Option.getOrThrow(model.person);

    const opened = update(
      { ...model, route: CalendarRoute.make({}) },
      Message.EditingAction({ action: EditorAction.cases.OpenCreate.make({}) })
    );

    const descriptor = opened.commands?.find(
      (command) => command.name === "DispatchEditing"
    );

    expect(descriptor, "real root create must dispatch editing").toBeDefined();

    const command = yield* Schema.decodeUnknownEffect(EditingCommand)(
      descriptor?.args?.command
    );

    const calendar = yield* Effect.fromNullishOr(
      model.calendar.calendars.find(
        (item) => item.accountId === "work" && item.primary
      )
    );

    const api = yield* editingRpcFixture([]);

    const services = Layer.merge(
      CalendarEditingClient.layer("available"),
      Layer.succeed(
        DeletionWriter,
        DeletionWriter.of({
          commit: () =>
            Effect.die(
              "Creating an inherited default must never delete an event"
            ),
        })
      )
    );

    const context = yield* Layer.build(
      EditingRuntime.layer.pipe(Layer.provide(services))
    ).pipe(
      Effect.provideService(
        Crypto.Crypto,
        Crypto.make({
          digest: () => Effect.die("Unexpected digest"),
          randomBytes: (size) => new Uint8Array(size).fill(1),
        })
      )
    );

    const runtime = yield* Effect.service(EditingRuntime).pipe(
      Effect.provide(context)
    );

    let current = opened.model;

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
          Queue.offerUnsafe(queue, notice);
        })
      ),
      Effect.forkScoped
    );

    const take = Effect.fn("test.takeInheritanceNotice")(function* take(
      matches: (notice: typeof EditingNotice.Type) => boolean
    ) {
      while (true) {
        const notice = yield* Queue.take(queue);

        if (matches(notice)) {
          return notice;
        }
      }
    });

    const editing = () => {
      const state = current.editing.view;

      if (!EditorView.guards.Editing(state)) {
        throw new Error("Expected the real editing actor to be ready");
      }

      return state;
    };

    const receive = (message: AppMessage) => {
      const result = update(current, message);
      current = result.model;

      return result;
    };

    const dispatch = Effect.fn("test.dispatchInheritanceEditor")(
      function* dispatch(action: typeof EditorAction.Type) {
        const result = receive(Message.EditingAction({ action }));

        for (const item of result.commands ?? []) {
          if (item.name === "DispatchEditing") {
            yield* runtime.dispatch(
              personId,
              yield* Schema.decodeUnknownEffect(EditingCommand)(
                item.args?.command
              )
            );
          }
        }
      }
    );

    const text = Effect.fn("test.typeInheritanceEditor")(function* text(
      field: "title" | "participantEmail",
      value: string
    ) {
      yield* dispatch(EditorAction.cases.TextEdited.make({ field, value }));
      yield* take(
        (notice) =>
          EditingNotice.guards.Editor(notice) &&
          EditorView.guards.Editing(notice.view) &&
          notice.view.draft[field] === value
      );
    });

    const add = Effect.fn("test.addInheritanceParticipant")(function* add(
      email: string
    ) {
      yield* text("participantEmail", email);
      yield* dispatch(EditorAction.cases.AddParticipant.make({}));
      yield* take(
        (notice) =>
          EditingNotice.guards.Editor(notice) &&
          EditorView.guards.Editing(notice.view) &&
          notice.view.draft.attendees.some(
            (attendee) => attendee.email === email
          )
      );
    });

    const save = Effect.fn("test.saveInheritanceDraft")(function* save() {
      yield* text("title", "Inheritance proof");
      yield* dispatch(EditorAction.cases.Save.make({}));
      yield* take(
        (notice) =>
          EditingNotice.guards.Editor(notice) &&
          (EditorView.guards.Email(notice.view) ||
            EditorView.guards.Failure(notice.view) ||
            Option.isSome(notice.error) ||
            (EditorView.guards.Editing(notice.view) &&
              Option.isSome(notice.view.error)))
      );
      expect(EditorView.guards.Email(current.editing.view)).toBe(true);
      expect(yield* Ref.get(api.fake.requests)).toEqual([]);

      const needsMeet =
        EditorView.guards.Email(current.editing.view) &&
        current.editing.view.draft.conferencing?.request?.kind === "googleMeet";

      const savedEvent = response(
        200,
        timedEvent("01010101010141018101010101010101", "Inheritance proof")
      );

      yield* Ref.set(
        api.fake.pending,
        needsMeet
          ? [
              response(200, {
                accessRole: "owner",
                conferenceProperties: {
                  allowedConferenceSolutionTypes:
                    calendar.allowedConferenceSolutionTypes ?? [],
                },
                defaultReminders: [],
                id: calendar.calendarId,
              }),
              savedEvent,
              response(
                200,
                timedEvent(
                  "01010101010141018101010101010101",
                  "Inheritance proof",
                  {
                    conferenceData: {
                      conferenceId: "abc-defg-hij",
                      conferenceSolution: {
                        key: { type: "hangoutsMeet" },
                        name: "Google Meet",
                      },
                      entryPoints: [
                        {
                          entryPointType: "video",
                          uri: "https://meet.google.com/abc-defg-hij",
                        },
                      ],
                    },
                  }
                )
              ),
            ]
          : [savedEvent]
      );
      yield* dispatch(EditorAction.cases.SendUpdates.make({ send: true }));

      const completed = yield* take(
        (notice) =>
          EditingNotice.guards.Editor(notice) &&
          (Option.isSome(notice.mutation) ||
            EditorView.guards.Failure(notice.view) ||
            Option.isSome(notice.error) ||
            (EditorView.guards.Editing(notice.view) &&
              Option.isSome(notice.view.error)))
      );

      expect(EditingNotice.guards.Editor(completed)).toBe(true);

      if (EditingNotice.guards.Editor(completed)) {
        expect(Option.isSome(completed.mutation)).toBe(true);
      }

      return { requests: yield* Ref.get(api.fake.requests), rpc: api.requests };
    });

    yield* runtime.dispatch(personId, command);
    yield* take(
      (notice) =>
        EditingNotice.guards.Editor(notice) &&
        EditorView.guards.Editing(notice.view)
    );
    expect(yield* Ref.get(api.fake.requests)).toEqual([]);
    expect(api.requests).toEqual([]);

    return {
      add,
      dispatch,
      editing,
      get: () => current,
      receive,
      requests: () => Ref.get(api.fake.requests),
      save,
      take,
    };
  },
  Effect.provide(NodeServices.layer)
);

import { CalendarEvent } from "@calendar/calendar/contracts";
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

import {
  ref,
  response,
  timedEvent,
} from "../../../packages/calendar/test/fake-google.js";
import { Message, RemoteSession, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { eventKey, RemoteEvents } from "../src/client/calendar-state.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionWriter } from "../src/client/editing/delete-actor.js";
import { DeleteNotice } from "../src/client/editing/deletion-session.js";
import {
  EditingCommand,
  EditingNotice,
  EditingRuntime,
} from "../src/client/editing/runtime.js";
import { editingRpcFixture } from "./editing-rpc-fixture.js";
import { editorCalendars } from "./editor-fixture.js";
import { fixtureModel } from "./fixture.js";

export const nextInstantNotice = Effect.fn("nextInstantNotice")(
  function* nextInstantNotice(
    queue: Queue.Queue<typeof EditingNotice.Type>,
    matches: (notice: typeof EditingNotice.Type) => boolean
  ) {
    while (true) {
      const notice = yield* Queue.take(queue);

      if (matches(notice)) {
        return notice;
      }

      if (
        EditingNotice.guards.Editor(notice) &&
        (["Email", "Scope", "RemoveRecurrence", "Failure"].includes(
          notice.view._tag
        ) ||
          Option.isSome(notice.error) ||
          Option.isSome(notice.mutation))
      ) {
        return yield* Effect.die(
          new Error(`Unexpected editor outcome: ${notice.view._tag}`)
        );
      }

      if (
        EditingNotice.guards.Delete(notice) &&
        DeleteNotice.guards.Settled(notice.notice)
      ) {
        return yield* Effect.die(
          new Error(`Unexpected delete outcome: ${notice.notice.outcome._tag}`)
        );
      }
    }
  }
);

type InstantEventFlags = Readonly<{
  eventType?: "default" | "outOfOffice";
  modifiable?: boolean;
  authoritativeModifiable?: boolean;
}>;

type FixtureEventFields = Readonly<{
  eventType?: "default" | "outOfOffice";
  guestsCanModify: boolean;
}>;

const fixtureEventFlags = (
  input: InstantEventFlags,
  authoritative: boolean
): FixtureEventFields => {
  const flags = {
    guestsCanModify: authoritative
      ? (input.authoritativeModifiable ?? input.modifiable ?? true)
      : (input.modifiable ?? true),
  };

  if (authoritative && input.eventType === undefined) {
    return flags;
  }

  return { eventType: input.eventType ?? "default", ...flags };
};

type FixtureParticipant = Readonly<{
  displayName: string;
  email: string;
  organizer: boolean;
  responseStatus: "accepted";
  self: boolean;
}>;

const fixtureAttendees = (
  attendees: readonly FixtureParticipant[],
  noGuests: boolean
) => (noGuests ? attendees.filter((person) => person.self) : attendees);

const fixtureParticipants = (
  organizer: boolean
): readonly FixtureParticipant[] => [
  {
    displayName: "Calendar owner",
    email: "owner@example.test",
    organizer,
    responseStatus: "accepted",
    self: true,
  },
  {
    displayName: "Alex",
    email: organizer ? "guest@example.test" : "host@example.test",
    organizer: !organizer,
    responseStatus: "accepted",
    self: false,
  },
];

const fixtureOrganizer = (self: boolean) => ({
  email: self ? "owner@example.test" : "host@example.test",
  self,
});

const providerNoGuests = (input: {
  readonly noGuests?: boolean;
  readonly authoritativeNoGuests?: boolean;
}) => input.authoritativeNoGuests ?? input.noGuests ?? false;

const EditingArgs = Schema.Struct({
  command: EditingCommand,
  personId: Schema.String,
});

export const instantRuntimeFixture = Effect.fn("instantRuntimeFixture")(
  function* instantRuntimeFixture(
    input: {
      readonly recurring: boolean;
      readonly organizer: boolean;
      readonly operation: "delete" | "save";
      readonly undo: boolean;
      readonly bulk?: boolean;
      readonly saveTimes?: Readonly<{ start: string; end: string }>;
      readonly readOnly?: boolean;
      readonly noGuests?: boolean;
      readonly mixedGuests?: boolean;
      readonly authoritativeNoGuests?: boolean;
      readonly authoritativeOrganizer?: boolean;
    } & InstantEventFlags
  ) {
    const start = { dateTime: "2026-10-21T09:00:00-07:00" };
    const end = { dateTime: "2026-10-21T10:00:00-07:00" };

    const participants = fixtureParticipants(input.organizer);

    const attendees = fixtureAttendees(participants, input.noGuests === true);

    const secondAttendees = fixtureAttendees(
      attendees,
      input.mixedGuests === true
    );

    const organizer = fixtureOrganizer(input.organizer);
    const actualOrganizer = input.authoritativeOrganizer ?? input.organizer;

    const providerAttendees = fixtureAttendees(
      fixtureParticipants(actualOrganizer),
      providerNoGuests(input)
    );

    const providerSecondAttendees = fixtureAttendees(
      providerAttendees,
      input.mixedGuests === true
    );

    const original = CalendarEvent.make({
      ...ref,
      attendees,
      end,
      eventId: "instant-instance",
      ...fixtureEventFlags(input, false),
      organizer,
      start,
      status: "confirmed",
      title: input.recurring ? "Design review" : "Weekly sync",
    });

    const source = input.recurring
      ? CalendarEvent.make({
          ...original,
          originalStartTime: start,
          recurringEventId: "instant-series",
        })
      : original;

    const providerBase = timedEvent(source.eventId, source.title ?? "Meeting", {
      attendees: providerAttendees,
      end,
      ...fixtureEventFlags(input, true),
      organizer: fixtureOrganizer(actualOrganizer),
      start,
    });

    const provider = input.recurring
      ? {
          ...providerBase,
          originalStartTime: start,
          recurringEventId: "instant-series",
        }
      : providerBase;

    const reads = [
      response(200, provider),
      ...(input.recurring
        ? [
            response(
              200,
              timedEvent("instant-series", "Design review", {
                end: { dateTime: "2026-10-19T10:00:00-07:00" },
                recurrence: ["RRULE:FREQ=DAILY"],
                start: { dateTime: "2026-10-19T09:00:00-07:00" },
              })
            ),
          ]
        : []),
    ];

    if (input.bulk === true) {
      reads.push(
        response(200, {
          ...provider,
          attendees: providerSecondAttendees,
          id: "instant-second",
          summary: "Second meeting",
        })
      );
    }

    if (input.operation === "delete") {
      reads.push(response(204));

      if (input.bulk === true) {
        reads.push(response(204));
      }
    }

    if (input.operation === "save") {
      const times = input.saveTimes ?? {
        end: "2026-10-21T12:00:00-07:00",
        start: "2026-10-21T11:00:00-07:00",
      };

      reads.push(
        response(200, provider),
        response(200, {
          ...provider,
          end: { dateTime: times.end },
          start: { dateTime: times.start },
        })
      );
    }

    const api = yield* editingRpcFixture(reads);

    const clientLayer = CalendarEditingClient.layer("notAvailable").pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, api.fetcher))
    );

    const writerLayer = Layer.effect(
      DeletionWriter,
      CalendarEditingClient.pipe(
        Effect.map((client) =>
          DeletionWriter.of({
            commit: (intent) =>
              client.deleteEvent(intent.request, intent.keepalive),
          })
        )
      )
    ).pipe(Layer.provide(clientLayer));

    let serial = 0;

    const crypto = Crypto.make({
      digest: () => Effect.die("Unexpected fixture digest"),
      randomBytes: (size) => {
        serial += 1;

        return new Uint8Array(size).fill(serial);
      },
    });

    const context = yield* Layer.build(
      EditingRuntime.layer.pipe(
        Layer.provide(Layer.merge(clientLayer, writerLayer))
      )
    ).pipe(Effect.provideService(Crypto.Crypto, crypto));

    const runtime = yield* Effect.service(EditingRuntime).pipe(
      Effect.provide(context)
    );

    const base = fixtureModel();
    const [calendar] = editorCalendars;

    if (calendar === undefined) {
      return yield* Effect.die("Missing editor calendar");
    }

    let sources =
      input.bulk === true
        ? [
            source,
            CalendarEvent.make({
              ...source,
              attendees: secondAttendees,
              eventId: "instant-second",
              title: "Second meeting",
            }),
            CalendarEvent.make({
              ...source,
              eventId: "instant-blocked",
              eventType: "outOfOffice",
              title: "Out of office",
            }),
          ]
        : [source];

    if (input.recurring && input.bulk !== true) {
      sources = [
        ...sources,
        CalendarEvent.make({
          ...source,
          end: { dateTime: "2026-10-22T10:00:00-07:00" },
          eventId: "instant-next-occurrence",
          originalStartTime: { dateTime: "2026-10-22T09:00:00-07:00" },
          start: { dateTime: "2026-10-22T09:00:00-07:00" },
        }),
      ];
    }

    const model: AppModel = {
      ...base,
      calendar: {
        ...base.calendar,
        calendars: [
          {
            ...calendar,
            ...ref,
            accessRole: input.readOnly === true ? "reader" : "owner",
            primary: input.readOnly !== true,
            title: "Work",
          },
        ],
        hidden: [],
        mergeDuplicates: false,
        reads: [
          {
            accountId: ref.accountId,
            events: RemoteEvents.Success({
              data: { events: sources, versions: [] },
            }),
          },
        ],
        selected:
          input.bulk === true ? sources.map(eventKey) : [eventKey(source)],
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
    const views: string[] = [];
    const personId = Option.getOrThrow(base.person);

    const notices = yield* runtime
      .connect(personId)
      .pipe(Effect.provideService(FetchHttpClient.Fetch, api.fetcher));

    yield* notices.pipe(
      Stream.runForEach((notice) =>
        Ref.update(state, (current) => {
          if (EditingNotice.guards.Editor(notice)) {
            views.push(notice.view._tag);
          }

          return update(current, Message.ReceivedEditing({ notice, personId }))
            .model;
        }).pipe(Effect.andThen(Queue.offer(queue, notice)))
      ),
      Effect.forkScoped
    );

    const dispatch = Effect.fn("dispatchInstantRoot")(function* dispatch(
      message: Parameters<typeof update>[1]
    ) {
      const result = update(yield* Ref.get(state), message);
      yield* Ref.set(state, result.model);

      for (const command of result.commands ?? []) {
        if (command.name === "DispatchEditing") {
          const args = yield* Schema.decodeUnknownEffect(EditingArgs)(
            command.args
          );

          yield* runtime.dispatch(args.personId, args.command);
        }
      }
    });

    return {
      api,
      dispatch,
      model,
      personId,
      queue,
      runtime,
      source,
      state,
      views,
    };
  }
);

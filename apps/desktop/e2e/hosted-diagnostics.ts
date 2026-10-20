import { desktopWire } from "@calendar/core/desktop-bridge";
import { Option, Schema } from "effect";

const nullable = <A, I>(schema: Schema.Codec<A, I>) =>
  Schema.Union([Schema.Null, schema]);

const EventTime = Schema.Union([
  Schema.Struct({ date: Schema.String }),
  Schema.Struct({
    dateTime: Schema.String,
    timeZone: Schema.optional(Schema.String),
  }),
]);

export const HostedState = Schema.Struct({
  acknowledgedTitle: nullable(Schema.String),
  bridge: Schema.String,
  calendarCount: Schema.Finite,
  deferred: nullable(Schema.String),
  desktopPhase: Schema.String,
  desktopRevision: nullable(Schema.Finite),
  documentEpoch: Schema.Finite,
  eventCount: Schema.Finite,
  eventTimes: Schema.Array(
    Schema.Struct({
      end: nullable(EventTime),
      start: nullable(EventTime),
      title: Schema.String,
    })
  ),
  hasPerson: Schema.Boolean,
  includeAllDay: nullable(Schema.Boolean),
  includeDays: nullable(Schema.Finite),
  includeWithoutConferencingOrLocation: nullable(Schema.Boolean),
  includeWithoutParticipants: nullable(Schema.Boolean),
  indexPhase: Schema.String,
  keyboardPrefix: Schema.String,
  keyboardScreen: Schema.String,
  menuBar: nullable(Schema.Boolean),
  now: Schema.Finite,
  projectedCount: Schema.Finite,
  queryCount: Schema.Finite,
  queryPersonMatches: nullable(Schema.Boolean),
  queryRange: nullable(
    Schema.Struct({ end: Schema.String, start: Schema.String })
  ),
  request: Schema.Finite,
  routeTag: Schema.String,
  saveAcknowledged: Schema.Boolean,
  selectedCount: Schema.Finite,
  timestamp: Schema.Finite,
  trigger: Schema.String,
  upcomingPhase: Schema.String,
  writeInQuery: nullable(Schema.Boolean),
  writeSelected: nullable(Schema.Boolean),
});

export type HostedStateValue = typeof HostedState.Type;

export const NativeTrace = Schema.Struct({
  dropped: Schema.Finite,
  navigations: Schema.Array(
    Schema.Struct({ kind: Schema.String, timestamp: Schema.Finite })
  ),
  publications: Schema.Array(
    Schema.Struct({
      navigated: Schema.Boolean,
      payload: Schema.String,
      sameFrameCoordinates: Schema.Boolean,
      sameFrameObject: Schema.Boolean,
      sameSender: Schema.Boolean,
      timestamp: Schema.Finite,
    })
  ),
  selectedWindowMatchesPage: Schema.Boolean,
  windowCount: Schema.Finite,
});

export const hostedFailureTrace = (
  decoded: Option.Option<typeof NativeTrace.Type>,
  states: readonly HostedStateValue[],
  reloadAt: number,
  savedAt?: number
) => {
  const relative = (timestamp: number) => ({
    afterReloadMilliseconds: timestamp - reloadAt,
    afterSaveMilliseconds: savedAt === undefined ? null : timestamp - savedAt,
    timestamp,
  });

  return {
    native: Option.match(decoded, {
      onNone: () => null,
      onSome: (trace) => ({
        dropped: trace.dropped,
        navigations: trace.navigations.map((event) => ({
          kind: event.kind,
          ...relative(event.timestamp),
        })),
        publications: trace.publications.map(
          ({ payload, timestamp, ...frame }) => ({
            ...frame,
            ...relative(timestamp),
            agenda: Option.match(
              Schema.decodeOption(desktopWire.agenda)(payload),
              {
                onNone: () => null,
                onSome: (snapshot) => ({
                  count: snapshot.events.length,
                  titles: snapshot.events.map((event) => event.title),
                }),
              }
            ),
          })
        ),
        selectedWindowMatchesPage: trace.selectedWindowMatchesPage,
        windowCount: trace.windowCount,
      }),
    }),
    states: states.map((state) => ({ ...state, ...relative(state.timestamp) })),
  };
};

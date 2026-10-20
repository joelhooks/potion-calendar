import { expect, it } from "@effect/vitest";
import { Effect, Layer, Predicate, Ref, Schema } from "effect";

import { CalendarService } from "../src/calendar.js";
import { moveAndRetimeSeries } from "../src/capabilities.js";
import { CalendarChanges } from "../src/changes.js";
import type { CalendarChangedValue } from "../src/changes.js";
import { Provider } from "../src/errors.js";
import { GoogleCalendarClient } from "../src/google.js";
import { memoryCalendarStore } from "../src/memory.js";
import {
  SeriesMoveRetimeFailure,
  SeriesMoveRetimePartial,
  SeriesMoveRetimeRefused,
  SeriesMoveRetimeUncertain,
} from "../src/series-move-result.js";
import { CalendarStore } from "../src/store.js";
import { GoogleHttp } from "../src/transport.js";
import { fakeGoogle, ref, response, timedEvent } from "./fake-google.js";

const zone = "America/Los_Angeles";

const destination = { ...ref, calendarId: "destination" };

const at = (day: string, hour: number, offset: string, minute = 0) => ({
  dateTime: `2026-03-${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${offset}`,
  timeZone: zone,
});

const master = timedEvent("master", "Series", {
  end: at("01", 10, "-08:00"),
  recurrence: ["RRULE:FREQ=WEEKLY;COUNT=5"],
  start: at("01", 9, "-08:00"),
});

const selected = (exception = false) =>
  timedEvent("selected", "Series", {
    end: at(exception ? "18" : "15", exception ? 15 : 10, "-07:00"),
    originalStartTime: at("15", 9, "-07:00"),
    recurringEventId: "master",
    start: at(exception ? "18" : "15", exception ? 13 : 9, "-07:00"),
  });

const moved = { ...master, id: "moved-master" };

const input = {
  ...ref,
  destination,
  end: at("15", 12, "-07:00"),
  eventId: "selected",
  start: at("15", 11, "-07:00"),
};

const failureCodec = Schema.toCodecJson(SeriesMoveRetimeFailure);

const bodySchema = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Json)
);

const serviceLayer = (
  fake: Effect.Success<ReturnType<typeof fakeGoogle>>,
  publish: (value: CalendarChangedValue) => Effect.Effect<void> = () =>
    Effect.void,
  http: Layer.Layer<GoogleHttp> = fake.layer
) =>
  CalendarService.layer.pipe(
    Layer.provideMerge(
      GoogleCalendarClient.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            fake.layer,
            http,
            memoryCalendarStore,
            Layer.succeed(CalendarChanges, { publish })
          )
        )
      )
    )
  );

it.effect.prop(
  "move then retime preserves the master's date and chosen LA wall clock across DST, including moved exceptions",
  {
    exception: Schema.Boolean,
    hour: Schema.Int.check(Schema.isBetween({ maximum: 14, minimum: 10 })),
    minutes: Schema.Int.check(Schema.isBetween({ maximum: 90, minimum: 30 })),
  },
  ({ hour, minutes, exception }) =>
    Effect.gen(function* movedAndRetimed() {
      const changes = {
        end: {
          dateTime: `2026-03-01T${hour + 8 + Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:00.000Z`,
          timeZone: zone,
        },
        start: {
          dateTime: `2026-03-01T${hour + 8}:00:00.000Z`,
          timeZone: zone,
        },
      };

      const fake = yield* fakeGoogle([
        response(200, selected(exception)),
        response(200, master),
        response(200, moved),
        response(200, { ...moved, ...changes }),
      ]);

      const signals = yield* Ref.make<readonly CalendarChangedValue[]>([]);
      yield* Effect.gen(function* verifySuccess() {
        const result = yield* moveAndRetimeSeries.handler({
          ...input,
          end: at(
            exception ? "18" : "15",
            hour + Math.floor(minutes / 60),
            "-07:00",
            minutes % 60
          ),
          start: at(exception ? "18" : "15", hour, "-07:00"),
        });

        expect(result.calendarId).toBe(destination.calendarId);
        expect(result.eventId).toBe("moved-master");
        expect(result.start).toEqual(changes.start);
        expect(result.end).toEqual(changes.end);
        expect(result.recurrence).toEqual(["RRULE:FREQ=WEEKLY;COUNT=5"]);
        const store = yield* CalendarStore;
        expect((yield* store.read(ref)).version).toBe(1);
        expect((yield* store.read(destination)).version).toBe(2);
      }).pipe(
        Effect.provide(
          serviceLayer(fake, (change) =>
            Ref.update(signals, (previous) => [...previous, change])
          )
        )
      );
      const requests = yield* Ref.get(fake.requests);
      expect(requests.map((request) => request.method)).toEqual([
        "GET",
        "GET",
        "POST",
        "PATCH",
      ]);
      expect(requests[2]?.path).toBe(
        "/calendars/calendar/events/master/move?destination=destination&sendUpdates=none"
      );
      expect(requests[3]?.path).toBe(
        "/calendars/destination/events/moved-master?sendUpdates=none"
      );
      expect(
        yield* Schema.decodeEffect(bodySchema)(requests[3]?.body ?? "")
      ).toEqual(changes);
      expect(yield* Ref.get(signals)).toEqual([
        { ...ref, reason: "write", version: 1 },
        { ...destination, reason: "write", version: 1 },
        { ...destination, reason: "write", version: 2 },
      ]);
    })
);

it.effect.prop(
  "a move failure cannot retime; a retime failure reports the completed move and actual destination identity",
  { stage: Schema.Literals(["move", "retime"]), uncertain: Schema.Boolean },
  ({ stage, uncertain }) =>
    Effect.gen(function* failureProgress() {
      const status = uncertain ? 503 : 403;

      const fake = yield* fakeGoogle([
        response(200, selected()),
        response(200, master),
        ...(stage === "retime" ? [response(200, moved)] : []),
        response(status),
      ]);

      yield* Effect.gen(function* verifyFailure() {
        const originalFailure = yield* CalendarService.use((calendar) =>
          calendar.moveAndRetimeSeries(input)
        ).pipe(Effect.flip);

        const encoded =
          yield* Schema.encodeEffect(failureCodec)(originalFailure);

        const failure = yield* Schema.decodeEffect(failureCodec)(encoded);

        const store = yield* CalendarStore;

        if (stage === "move") {
          if (uncertain) {
            expect(failure).toBeInstanceOf(SeriesMoveRetimeUncertain);

            if (Predicate.isTagged(failure, "SeriesMoveRetimeUncertain")) {
              expect(failure.source).toEqual({ ...ref, eventId: "master" });
              expect(failure.destination).toEqual(destination);
              expect(failure.cause._tag).toBe("Provider");
            }
          } else {
            expect(failure).toBeInstanceOf(Provider);
          }

          expect((yield* store.read(ref)).version).toBe(uncertain ? 1 : 0);
          expect((yield* store.read(destination)).version).toBe(
            uncertain ? 1 : 0
          );
        } else {
          expect(failure).toBeInstanceOf(SeriesMoveRetimePartial);

          if (Predicate.isTagged(failure, "SeriesMoveRetimePartial")) {
            expect(failure.completedStep).toBe("move");
            expect(failure.movedEvent.calendarId).toBe(destination.calendarId);
            expect(failure.movedEvent.eventId).toBe("moved-master");
            expect(failure.movedEvent.start).toEqual(master.start);
            expect(failure.changes.start).toEqual({
              dateTime: "2026-03-01T19:00:00.000Z",
              timeZone: zone,
            });
            expect(failure.retimeOutcome).toBe(
              uncertain ? "unknown" : "rejected"
            );
          }

          expect((yield* store.read(ref)).version).toBe(1);
          expect((yield* store.read(destination)).version).toBe(
            uncertain ? 2 : 1
          );
        }
      }).pipe(Effect.provide(serviceLayer(fake)));
      expect(
        (yield* Ref.get(fake.requests)).map((request) => request.method)
      ).toEqual(
        stage === "move"
          ? ["GET", "GET", "POST"]
          : ["GET", "GET", "POST", "PATCH"]
      );
      expect(yield* Ref.get(fake.pending)).toEqual([]);
    })
);

it.effect.prop(
  "transport failure after sending never advances an unconfirmed move or hides a completed move",
  { stage: Schema.Literals(["move", "retime"]) },
  ({ stage }) =>
    Effect.gen(function* transportUncertainty() {
      const fake = yield* fakeGoogle([
        response(200, selected()),
        response(200, master),
        ...(stage === "retime" ? [response(200, moved)] : []),
        response(0),
      ]);

      const underlying = yield* GoogleHttp.pipe(Effect.provide(fake.layer));

      const http = Layer.succeed(GoogleHttp, {
        execute: (request, bearer) =>
          underlying.execute(request, bearer).pipe(
            Effect.filterOrFail(
              (result) => result.status !== 0,
              () =>
                new Provider({
                  message: "Connection lost after send",
                  operation: request.method,
                  status: 0,
                })
            )
          ),
      });

      const failure = yield* CalendarService.use((calendar) =>
        calendar.moveAndRetimeSeries(input)
      ).pipe(
        Effect.flip,
        Effect.provide(serviceLayer(fake, () => Effect.void, http))
      );

      expect(
        stage === "move"
          ? Predicate.isTagged(failure, "SeriesMoveRetimeUncertain")
          : Predicate.isTagged(failure, "SeriesMoveRetimePartial")
      ).toBe(true);

      if (Predicate.isTagged(failure, "SeriesMoveRetimePartial")) {
        expect(failure.retimeOutcome).toBe("unknown");
      }

      expect(
        (yield* Ref.get(fake.requests)).filter(
          (request) => request.method === "PATCH"
        )
      ).toHaveLength(stage === "move" ? 0 : 1);
    })
);

it.effect.prop(
  "changed dates, invalid durations, non-recurring selections, and date-only fields refuse before writes",
  {
    reason: Schema.Literals([
      "dateChanged",
      "invalidDuration",
      "invalidTime",
      "notRecurringInstance",
      "timedEventRequired",
    ]),
  },
  ({ reason }) =>
    Effect.gen(function* preflightRefusal() {
      const fake = yield* fakeGoogle(
        reason === "notRecurringInstance"
          ? [response(200, timedEvent("selected"))]
          : [response(200, selected()), response(200, master)]
      );

      const times =
        reason === "dateChanged"
          ? { end: at("16", 12, "-07:00"), start: at("16", 11, "-07:00") }
          : { end: input.end, start: input.start };

      const failure = yield* CalendarService.use((calendar) => {
        if (reason === "timedEventRequired") {
          return calendar.moveAndRetimeSeries({
            ...input,
            end: { date: "2026-03-16" },
            start: { date: "2026-03-15" },
          });
        }

        if (reason === "invalidDuration") {
          return calendar.moveAndRetimeSeries({ ...input, end: input.start });
        }

        if (reason === "invalidTime") {
          return calendar.moveAndRetimeSeries({
            ...input,
            start: { dateTime: "2026-03-15T11:00:00", timeZone: zone },
          });
        }

        return calendar.moveAndRetimeSeries({ ...input, ...times });
      }).pipe(Effect.flip, Effect.provide(serviceLayer(fake)));

      expect(failure).toEqual(
        new SeriesMoveRetimeRefused({ ...ref, eventId: "selected", reason })
      );
      expect(
        (yield* Ref.get(fake.requests)).every(
          (request) => request.method === "GET"
        )
      ).toBe(true);
    })
);

it.effect(
  "same-day validation uses the master's zone rather than UTC dates, and preserves overnight duration",
  () =>
    Effect.gen(function* localDay() {
      const changes = {
        end: { dateTime: "2026-03-02T08:30:00.000Z", timeZone: zone },
        start: { dateTime: "2026-03-02T07:30:00.000Z", timeZone: zone },
      };

      const fake = yield* fakeGoogle([
        response(200, selected()),
        response(200, master),
        response(200, moved),
        response(200, { ...moved, ...changes }),
      ]);

      const result = yield* CalendarService.use((calendar) =>
        calendar.moveAndRetimeSeries({
          ...input,
          end: { dateTime: "2026-03-16T07:30:00Z" },
          start: { dateTime: "2026-03-16T06:30:00Z" },
        })
      ).pipe(Effect.provide(serviceLayer(fake)));

      expect(result.start).toEqual(changes.start);
      expect(result.end).toEqual(changes.end);
      const requests = yield* Ref.get(fake.requests);
      expect(
        yield* Schema.decodeEffect(bodySchema)(requests.at(-1)?.body ?? "")
      ).toEqual(changes);
    })
);

it.effect(
  "a UTC-same-day timestamp on another master-zone day is refused",
  () =>
    Effect.gen(function* changedLocalDay() {
      const fake = yield* fakeGoogle([
        response(200, selected()),
        response(200, master),
      ]);

      const failure = yield* CalendarService.use((calendar) =>
        calendar.moveAndRetimeSeries({
          ...input,
          end: { dateTime: "2026-03-15T02:00:00Z" },
          start: { dateTime: "2026-03-15T01:00:00Z" },
        })
      ).pipe(Effect.flip, Effect.provide(serviceLayer(fake)));

      expect(failure).toEqual(
        new SeriesMoveRetimeRefused({
          ...ref,
          eventId: "selected",
          reason: "dateChanged",
        })
      );
      expect(
        (yield* Ref.get(fake.requests)).every(
          (request) => request.method === "GET"
        )
      ).toBe(true);
    })
);

it.effect(
  "an accepted move response that cannot be decoded is uncertain and cannot trigger a guessed-ID patch",
  () =>
    Effect.gen(function* invalidMoveResponse() {
      const fake = yield* fakeGoogle([
        response(200, selected()),
        response(200, master),
        response(200, {}),
      ]);

      yield* Effect.gen(function* verifyUnconfirmedResponse() {
        const failure = yield* CalendarService.use((calendar) =>
          calendar.moveAndRetimeSeries(input)
        ).pipe(Effect.flip);

        expect(failure).toBeInstanceOf(SeriesMoveRetimeUncertain);
        const store = yield* CalendarStore;
        expect((yield* store.read(ref)).version).toBe(1);
        expect((yield* store.read(destination)).version).toBe(1);
      }).pipe(Effect.provide(serviceLayer(fake)));
      expect(
        (yield* Ref.get(fake.requests)).map((request) => request.method)
      ).toEqual(["GET", "GET", "POST"]);
    })
);

it.effect(
  "a DST interval that cannot retain both chosen wall clocks and elapsed duration refuses before moving",
  () =>
    Effect.gen(function* incompatibleDuration() {
      const springMaster = {
        ...master,
        end: at("08", 3, "-07:00"),
        start: at("08", 1, "-08:00"),
      };

      const fake = yield* fakeGoogle([
        response(200, selected()),
        response(200, springMaster),
      ]);

      const failure = yield* CalendarService.use((calendar) =>
        calendar.moveAndRetimeSeries({
          ...input,
          end: at("15", 3, "-07:00", 30),
          start: at("15", 1, "-07:00", 30),
        })
      ).pipe(Effect.flip, Effect.provide(serviceLayer(fake)));

      expect(failure).toEqual(
        new SeriesMoveRetimeRefused({
          ...ref,
          eventId: "selected",
          reason: "durationTransition",
        })
      );
      expect(
        (yield* Ref.get(fake.requests)).every(
          (request) => request.method === "GET"
        )
      ).toBe(true);
    })
);

it.effect(
  "a wall clock missing on the master's DST transition date refuses before moving",
  () =>
    Effect.gen(function* missingClock() {
      const springMaster = {
        ...master,
        end: at("08", 3, "-07:00"),
        start: at("08", 1, "-08:00"),
      };

      const fake = yield* fakeGoogle([
        response(200, selected()),
        response(200, springMaster),
      ]);

      const failure = yield* CalendarService.use((calendar) =>
        calendar.moveAndRetimeSeries({
          ...input,
          end: at("15", 3, "-07:00", 30),
          start: at("15", 2, "-07:00", 30),
        })
      ).pipe(Effect.flip, Effect.provide(serviceLayer(fake)));

      expect(failure).toEqual(
        new SeriesMoveRetimeRefused({
          ...ref,
          eventId: "selected",
          reason: "unrepresentableTime",
        })
      );
      expect(
        (yield* Ref.get(fake.requests)).every(
          (request) => request.method === "GET"
        )
      ).toBe(true);
    })
);

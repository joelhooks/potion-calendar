import { NotConnected, Provider } from "@calendar/calendar";
import {
  CalendarEvent,
  EventTime,
  SeriesMoveRetimeFailure,
  SeriesMoveRetimePartial,
  SeriesMoveRetimeRefused,
  SeriesMoveRetimeUncertain,
} from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Ref, Schema } from "effect";

import { rpcFailure, rpcValue } from "./calendar-rpc.js";
import {
  master,
  moved,
  reply,
  retimed,
  selected,
  seriesRpcFixture,
  zone,
} from "./series-rpc-fixture.js";

const Changes = Schema.fromJsonString(
  Schema.Struct({ end: EventTime, start: EventTime })
);

it.effect(
  "series move RPC preserves the master date and publishes both calendar versions through the person sink",
  () =>
    Effect.gen(function* success() {
      const fixture = yield* seriesRpcFixture([
        reply(200, selected),
        reply(200, master),
        reply(200, moved),
        reply(200, retimed),
      ]);

      const document = yield* fixture.send();

      const result = (yield* Schema.decodeUnknownEffect(
        rpcValue(CalendarEvent)
      )(document))[0].exit.value;

      expect(result.eventId).toBe("destination-master");
      expect(result.calendarId).toBe(fixture.destination.calendarId);
      expect(result.start).toEqual(retimed.start);
      expect(result.end).toEqual(retimed.end);
      expect(result.recurrence).toEqual(master.recurrence);

      const requests = yield* Ref.get(fixture.requests);

      expect(requests.map((request) => request.method)).toEqual([
        "GET",
        "GET",
        "POST",
        "PATCH",
      ]);
      expect(requests[2]?.path).toBe(
        "/calendars/source/events/master/move?destination=destination&sendUpdates=none"
      );
      expect(requests[3]?.path).toBe(
        "/calendars/destination/events/destination-master?sendUpdates=none"
      );
      expect(
        yield* Schema.decodeEffect(Changes)(requests[3]?.body ?? "")
      ).toEqual({ end: retimed.end, start: retimed.start });
      expect(yield* Ref.get(fixture.signals)).toEqual([
        {
          change: { ...fixture.source, reason: "write", version: 1 },
          personId: fixture.personId,
        },
        {
          change: { ...fixture.destination, reason: "write", version: 1 },
          personId: fixture.personId,
        },
        {
          change: { ...fixture.destination, reason: "write", version: 2 },
          personId: fixture.personId,
        },
      ]);
      expect((yield* fixture.store.read(fixture.source)).version).toBe(1);
      expect((yield* fixture.store.read(fixture.destination)).version).toBe(2);
    })
);

it.effect(
  "series move RPC preserves the typed partial outcome and returned destination master after retime rejection",
  () =>
    Effect.gen(function* partial() {
      const fixture = yield* seriesRpcFixture([
        reply(200, selected),
        reply(200, master),
        reply(200, moved),
        reply(403),
      ]);

      const document = yield* fixture.send();

      const failure = (yield* Schema.decodeUnknownEffect(
        rpcFailure(SeriesMoveRetimeFailure)
      )(document))[0].exit.cause[0].error;

      expect(failure).toBeInstanceOf(SeriesMoveRetimePartial);

      if (!Schema.is(SeriesMoveRetimePartial)(failure)) {
        return yield* Effect.die(
          new Error("Expected the typed partial outcome")
        );
      }

      expect(failure.completedStep).toBe("move");
      expect(failure.movedEvent.eventId).toBe("destination-master");
      expect(failure.movedEvent.calendarId).toBe(
        fixture.destination.calendarId
      );
      expect(failure.movedEvent.start).toEqual(master.start);
      expect(failure.retimeOutcome).toBe("rejected");
      expect(failure.cause).toBeInstanceOf(Provider);
      expect(failure.changes.start).toEqual(retimed.start);
      expect(
        (yield* Ref.get(fixture.requests)).map((request) => request.method)
      ).toEqual(["GET", "GET", "POST", "PATCH"]);
      expect(yield* Ref.get(fixture.signals)).toEqual([
        {
          change: { ...fixture.source, reason: "write", version: 1 },
          personId: fixture.personId,
        },
        {
          change: { ...fixture.destination, reason: "write", version: 1 },
          personId: fixture.personId,
        },
      ]);

      return yield* Effect.void;
    })
);

it.effect(
  "series move RPC reports transport loss as typed uncertain without retrying or retiming",
  () =>
    Effect.gen(function* uncertain() {
      const fixture = yield* seriesRpcFixture([
        reply(200, selected),
        reply(200, master),
        Effect.fail(
          new Provider({
            message: "Fixture move transport lost",
            operation: "POST",
            status: 0,
          })
        ),
      ]);

      const document = yield* fixture.send();

      const failure = (yield* Schema.decodeUnknownEffect(
        rpcFailure(SeriesMoveRetimeFailure)
      )(document))[0].exit.cause[0].error;

      expect(failure).toBeInstanceOf(SeriesMoveRetimeUncertain);

      if (!Schema.is(SeriesMoveRetimeUncertain)(failure)) {
        return yield* Effect.die(
          new Error("Expected the typed uncertain outcome")
        );
      }

      expect(failure.source).toEqual({ ...fixture.source, eventId: "master" });
      expect(failure.destination).toEqual(fixture.destination);
      expect(failure.cause).toBeInstanceOf(Provider);
      expect(
        (yield* Ref.get(fixture.requests)).map((request) => request.method)
      ).toEqual(["GET", "GET", "POST"]);
      expect((yield* fixture.store.read(fixture.source)).version).toBe(1);
      expect((yield* fixture.store.read(fixture.destination)).version).toBe(1);

      return yield* Effect.void;
    })
);

it.effect(
  "series move RPC refuses a changed local date before any provider write or invalidation",
  () =>
    Effect.gen(function* dateRefusal() {
      const fixture = yield* seriesRpcFixture([
        reply(200, selected),
        reply(200, master),
      ]);

      const document = yield* fixture.send({
        ...fixture.input,
        end: { dateTime: "2026-03-16T12:00:00-07:00", timeZone: zone },
        start: { dateTime: "2026-03-16T11:00:00-07:00", timeZone: zone },
      });

      const failure = (yield* Schema.decodeUnknownEffect(
        rpcFailure(SeriesMoveRetimeFailure)
      )(document))[0].exit.cause[0].error;

      expect(failure).toBeInstanceOf(SeriesMoveRetimeRefused);

      if (!Schema.is(SeriesMoveRetimeRefused)(failure)) {
        return yield* Effect.die(new Error("Expected the typed date refusal"));
      }

      expect(failure.reason).toBe("dateChanged");
      expect(
        (yield* Ref.get(fixture.requests)).map((request) => request.method)
      ).toEqual(["GET", "GET"]);
      expect(yield* Ref.get(fixture.signals)).toEqual([]);
      expect((yield* fixture.store.read(fixture.source)).version).toBe(0);
      expect((yield* fixture.store.read(fixture.destination)).version).toBe(0);

      return yield* Effect.void;
    })
);

for (const side of ["source", "destination"]) {
  it.effect(
    `series move RPC refuses another person's ${side} account before constructing storage or calling Google`,
    () =>
      Effect.gen(function* foreignRefusal() {
        const fixture = yield* seriesRpcFixture([]);

        const payload =
          side === "source"
            ? { ...fixture.input, accountId: fixture.foreignAccountId }
            : {
                ...fixture.input,
                destination: {
                  ...fixture.destination,
                  accountId: fixture.foreignAccountId,
                },
              };

        const document = yield* fixture.send(payload);

        const failure = (yield* Schema.decodeUnknownEffect(
          rpcFailure(SeriesMoveRetimeFailure)
        )(document))[0].exit.cause[0].error;

        expect(failure).toBeInstanceOf(NotConnected);
        expect(fixture.storePeople).toEqual([]);
        expect(yield* Ref.get(fixture.requests)).toEqual([]);
        expect(yield* Ref.get(fixture.signals)).toEqual([]);
      })
  );
}

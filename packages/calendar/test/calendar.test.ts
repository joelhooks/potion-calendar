import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Layer, Option, Ref, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { CalendarService } from "../src/calendar.js";
import { CalendarChanges } from "../src/changes.js";
import type { CalendarChangedValue } from "../src/changes.js";
import { Revoked, UnsupportedRecurrenceSplit } from "../src/errors.js";
import { GoogleCalendarClient } from "../src/google.js";
import { memoryCalendarStore } from "../src/memory.js";
import { fakeGoogle, ref, response, timedEvent } from "./fake-google.js";

const titleArbitrary = Arbitrary.schema(Schema.String);

const scopeArbitrary = Arbitrary.schema(
  Schema.Literals(["single", "allFollowing", "all"])
);

const start = {
  dateTime: "2026-03-15T09:00:00-07:00",
  timeZone: "America/Los_Angeles",
};

const end = {
  dateTime: "2026-03-15T10:00:00-07:00",
  timeZone: "America/Los_Angeles",
};

const bodySchema = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Json)
);

const serviceLayer = (fake: Effect.Success<ReturnType<typeof fakeGoogle>>) =>
  CalendarService.layer.pipe(
    Layer.provideMerge(GoogleCalendarClient.layer),
    Layer.provide(Layer.merge(fake.layer, memoryCalendarStore))
  );

describe("Calendar service against fake Google", () => {
  it.effect.prop(
    "one account can fail before or after another account succeeds",
    {
      failingFirst: Arbitrary.schema(Schema.Boolean),
    },
    ({ failingFirst }) =>
      Effect.gen(function* independentAccounts() {
        const palette = { calendar: {}, event: {} };

        const success = [
          response(200, palette),
          response(200, { items: [{ accessRole: "owner", id: "primary" }] }),
        ];

        const failed = {
          disconnected: false,
          email: "failed@example.test",
          id: "failed",
        };

        const connected = {
          disconnected: false,
          email: "owner@example.test",
          id: "account",
        };

        const fake = yield* fakeGoogle(
          failingFirst
            ? [response(403), ...success]
            : [...success, response(403)],
          failingFirst ? [failed, connected] : [connected, failed]
        );

        const result = yield* CalendarService.use((calendar) =>
          calendar.listCalendars()
        ).pipe(Effect.provide(serviceLayer(fake)));

        const good = result.accounts.find(
          (entry) => entry.accountId === "account"
        );

        const bad = result.accounts.find(
          (entry) => entry.accountId === "failed"
        );

        expect(result.accounts).toHaveLength(2);

        if (
          good === undefined ||
          !("calendars" in good) ||
          bad === undefined ||
          !("failure" in bad)
        ) {
          return yield* Effect.die(
            new Error("Expected one successful and one failed account")
          );
        }

        expect(good.calendars.map((calendar) => calendar.calendarId)).toEqual([
          "primary",
        ]);
        expect(good.colors).toEqual(palette);
        expect(bad.failure._tag).toBe("Provider");
        expect(yield* Ref.get(fake.pending)).toEqual([]);

        return yield* Effect.void;
      })
  );

  it.effect(
    "disconnected accounts remain visible as typed failures without provider calls",
    () =>
      Effect.gen(function* disconnectedAccount() {
        const fake = yield* fakeGoogle(
          [],
          [{ disconnected: true, email: "owner@example.test", id: "account" }]
        );

        const result = yield* CalendarService.use((calendar) =>
          calendar.listCalendars()
        ).pipe(Effect.provide(serviceLayer(fake)));

        expect(result.accounts).toHaveLength(1);
        const [account] = result.accounts;

        if (account === undefined || !("failure" in account)) {
          return yield* Effect.die(
            new Error("Expected a disconnected account failure")
          );
        }

        expect(account.accountId).toBe("account");
        expect(account.failure).toEqual(new Revoked({ accountId: "account" }));
        expect(yield* Ref.get(fake.requests)).toEqual([]);

        return yield* Effect.void;
      })
  );

  it.effect.prop(
    "event and range failures preserve account and calendar identity with the typed cause",
    {
      rangeRead: Arbitrary.schema(Schema.Boolean),
      status: Arbitrary.schema(Schema.Literals([401, 403, 404, 410])),
    },
    ({ rangeRead, status }) =>
      Effect.gen(function* readFailureIdentity() {
        const fake = yield* fakeGoogle(
          status === 401
            ? [response(status), response(status)]
            : [response(status)]
        );

        const failure = yield* CalendarService.use((calendar) =>
          rangeRead
            ? calendar
                .listEvents({
                  calendars: [ref],
                  range: {
                    end: "2026-04-01T00:00:00Z",
                    start: "2026-03-01T00:00:00Z",
                  },
                })
                .pipe(Effect.asVoid)
            : calendar
                .getEvent({ ...ref, eventId: "event" })
                .pipe(Effect.asVoid)
        ).pipe(Effect.flip, Effect.provide(serviceLayer(fake)));

        expect(failure.accountId).toBe(ref.accountId);
        expect(failure.calendarId).toBe(ref.calendarId);
        expect(failure.cause._tag).toBe(
          { 401: "Revoked", 403: "Provider", 404: "NotFound", 410: "Gone" }[
            status
          ]
        );
      })
  );
  it.effect.prop(
    "unsupported recurring splits fail before either provider write",
    {
      reason: Arbitrary.schema(
        Schema.Literals(["multipleRules", "rdate", "countWithExdate"])
      ),
    },
    ({ reason }) =>
      Effect.gen(function* unsupportedSplit() {
        const recurrence = {
          countWithExdate: [
            "RRULE:FREQ=WEEKLY;COUNT=5",
            "EXDATE:20260308T160000Z",
          ],
          multipleRules: ["RRULE:FREQ=DAILY", "RRULE:FREQ=WEEKLY"],
          rdate: ["RRULE:FREQ=WEEKLY", "RDATE:20260315T160000Z"],
        }[reason];

        const fake = yield* fakeGoogle([
          response(
            200,
            timedEvent("instance", "old", {
              originalStartTime: start,
              recurringEventId: "master",
            })
          ),
          response(200, timedEvent("master", "old", { recurrence })),
        ]);

        const failure = yield* CalendarService.use((calendar) =>
          calendar.updateEvent({
            ...ref,
            changes: { title: "new" },
            eventId: "instance",
            scope: "allFollowing",
          })
        ).pipe(Effect.flip, Effect.provide(serviceLayer(fake)));

        expect(failure).toEqual(new UnsupportedRecurrenceSplit({ reason }));
        expect(
          (yield* Ref.get(fake.requests)).every(
            (request) => request.method === "GET"
          )
        ).toBe(true);
      })
  );
  it.effect(
    "a fresh worker resumes a split after successor creation without creating a second successor",
    () =>
      Effect.gen(function* splitCrashRecovery() {
        const successorId =
          "5gs3im3rr9eibpmr7q7i3evfklbcfkoqkp32mv3mgl6fkv7u592g";

        const selected = timedEvent("instance", "old", {
          originalStartTime: start,
          recurringEventId: "master",
        });

        const master = timedEvent("master", "old", {
          recurrence: ["RRULE:FREQ=WEEKLY"],
        });

        const successor = timedEvent(successorId, "new");

        const fake = yield* fakeGoogle([
          response(200, selected),
          response(200, master),
          response(200, master),
          response(200, successor),
        ]);

        yield* Ref.set(fake.crashAt, Option.some(5));

        const operation = CalendarService.use((calendar) =>
          calendar.updateEvent({
            ...ref,
            changes: { title: "new" },
            eventId: "instance",
            scope: "allFollowing",
          })
        );

        const published = yield* Ref.make<readonly CalendarChangedValue[]>([]);

        const signals = Layer.succeed(CalendarChanges, {
          publish: (change) =>
            Ref.update(published, (previous) => [...previous, change]),
        });

        const crashed = yield* operation.pipe(
          Effect.provide(serviceLayer(fake).pipe(Layer.provide(signals))),
          Effect.exit
        );

        expect(Exit.isFailure(crashed)).toBe(true);
        expect(yield* Ref.get(published)).toEqual([
          { ...ref, reason: "write", version: 1 },
        ]);
        yield* Ref.set(fake.crashAt, Option.none());
        yield* Ref.set(fake.pending, [
          response(200, selected),
          response(200, master),
          response(200, master),
          response(409),
          response(200, successor),
          response(200, master),
        ]);

        const resumed = yield* operation.pipe(
          Effect.provide(serviceLayer(fake))
        );

        expect(resumed.eventId).toBe(successorId);
        const requests = yield* Ref.get(fake.requests);
        const creates = requests.filter((request) => request.method === "POST");
        expect(creates).toHaveLength(2);

        for (const request of creates) {
          const body = yield* Schema.decodeEffect(bodySchema)(
            request.body ?? ""
          );

          expect(body.id).toBe(successorId);
        }

        const last = requests.at(-1);
        expect(last?.method).toBe("PATCH");

        const truncated = yield* Schema.decodeEffect(bodySchema)(
          last?.body ?? ""
        );

        expect(truncated.recurrence).toEqual([
          "RRULE:FREQ=WEEKLY;UNTIL=20260315T155959Z",
        ]);
        expect(yield* Ref.get(fake.pending)).toEqual([]);
      })
  );
  it.effect.prop(
    "visible ranges preserve Google-expanded DST instants and suppress cancellations",
    { title: titleArbitrary },
    ({ title }) =>
      Effect.gen(function* scenario0() {
        const before = timedEvent("before", title, {
          start: { dateTime: "2026-03-01T09:00:00-08:00" },
        });

        const after = timedEvent("after", title);

        const fake = yield* fakeGoogle([
          response(200, { items: [before], nextPageToken: "second" }),
          response(200, {
            items: [after, { id: "cancelled", status: "cancelled" }],
          }),
        ]);

        yield* Effect.gen(function* scenario1() {
          const calendar = yield* CalendarService;

          const result = yield* calendar.listEvents({
            calendars: [ref],
            range: {
              end: "2026-04-01T00:00:00-07:00",
              start: "2026-03-01T00:00:00-08:00",
            },
          });

          expect(
            result.events.map((event) => [event.eventId, event.start])
          ).toEqual([
            ["before", before.start],
            ["after", after.start],
          ]);

          for (const request of yield* Ref.get(fake.requests)) {
            const query = new URL(`https://fake.test${request.path}`)
              .searchParams;

            expect(query.get("timeMin")).toBe("2026-03-01T00:00:00-08:00");
            expect(query.get("timeMax")).toBe("2026-04-01T00:00:00-07:00");
            expect(query.get("singleEvents")).toBe("true");
            expect(query.has("syncToken")).toBe(false);
          }
        }).pipe(Effect.provide(serviceLayer(fake)));
      })
  );

  it.effect.prop(
    "create retries fetch the stable id on conflict without emailing",
    { title: titleArbitrary },
    ({ title }) =>
      Effect.gen(function* scenario2() {
        const fake = yield* fakeGoogle([
          response(409),
          response(200, timedEvent("abcde", title)),
        ]);

        yield* Effect.gen(function* scenario3() {
          const calendar = yield* CalendarService;

          const event = yield* calendar.createEvent({
            ...ref,
            event: { end, start, title },
            id: "abcde",
          });

          expect(event.eventId).toBe("abcde");
          expect(event.title).toBe(title);
          const requests = yield* Ref.get(fake.requests);
          expect(requests.map((request) => request.method)).toEqual([
            "POST",
            "GET",
          ]);
          expect(requests[0]?.path).toContain("sendUpdates=none");

          const body = yield* Schema.decodeEffect(bodySchema)(
            requests[0]?.body ?? ""
          );

          expect(body.id).toBe("abcde");
          expect(body.summary).toBe(title);
        }).pipe(Effect.provide(serviceLayer(fake)));
      })
  );

  it.effect.prop(
    "edits use the selected recurring scope and create a successor before truncation",
    { scope: scopeArbitrary, title: titleArbitrary },
    ({ scope, title }) =>
      Effect.gen(function* scenario4() {
        const selected = timedEvent("instance", "old", {
          originalStartTime: start,
          recurringEventId: "master",
        });

        const master = timedEvent("master", "old", {
          recurrence: ["RRULE:FREQ=WEEKLY"],
          start: {
            dateTime: "2026-03-01T09:00:00-08:00",
            timeZone: "America/Los_Angeles",
          },
        });

        const scripts = {
          all: [
            response(200, selected),
            response(200, master),
            response(200, timedEvent("master", title)),
          ],
          allFollowing: [
            response(200, selected),
            response(200, master),
            response(200, master),
            response(200, timedEvent("abcde", title)),
            response(200, master),
          ],
          single: [
            response(200, selected),
            response(200, timedEvent("instance", title)),
          ],
        };

        const script = scripts[scope];

        const fake = yield* fakeGoogle(script);
        yield* Effect.gen(function* scenario5() {
          const calendar = yield* CalendarService;
          yield* calendar.updateEvent({
            ...ref,
            changes: { title },
            eventId: "instance",
            scope,
          });

          const writes = (yield* Ref.get(fake.requests)).filter(
            (request) => request.method !== "GET"
          );

          const firstWrite = yield* Schema.decodeEffect(bodySchema)(
            writes[0]?.body ?? ""
          );

          expect(firstWrite.summary).toBe(title);

          expect(
            writes.every((request) => request.path.endsWith("sendUpdates=none"))
          ).toBe(true);

          if (scope === "single") {
            expect(writes[0]?.path).toContain("/instance?");
          } else if (scope === "all") {
            expect(writes[0]?.path).toContain("/master?");
          } else {
            expect(writes.map((request) => request.method)).toEqual([
              "POST",
              "PATCH",
            ]);

            const truncate = yield* Schema.decodeEffect(bodySchema)(
              writes[1]?.body ?? ""
            );

            expect(truncate.recurrence).toEqual([
              "RRULE:FREQ=WEEKLY;UNTIL=20260315T155959Z",
            ]);

            const successor = yield* Schema.decodeEffect(bodySchema)(
              writes[0]?.body ?? ""
            );

            expect(successor.recurrence).toEqual(["RRULE:FREQ=WEEKLY"]);
            expect(successor.start).toEqual(start);
          }
        }).pipe(Effect.provide(serviceLayer(fake)));
      })
  );

  it.effect.prop(
    "delete respects each scope and treats missing events as already deleted",
    { scope: scopeArbitrary },
    ({ scope }) =>
      Effect.gen(function* scenario6() {
        const selected = timedEvent("instance", "old", {
          originalStartTime: start,
          recurringEventId: "master",
        });

        const master = timedEvent("master", "old", {
          recurrence: ["RRULE:FREQ=WEEKLY"],
        });

        const script =
          scope === "single"
            ? [response(404)]
            : [
                response(200, selected),
                response(200, master),
                scope === "all" ? response(410) : response(200, master),
              ];

        const fake = yield* fakeGoogle(script);
        yield* Effect.gen(function* scenario7() {
          const calendar = yield* CalendarService;
          yield* calendar.deleteEvent({ ...ref, eventId: "instance", scope });

          const write = (yield* Ref.get(fake.requests)).find(
            (request) => request.method !== "GET"
          );

          expect(write?.method).toBe(
            scope === "allFollowing" ? "PATCH" : "DELETE"
          );
          expect(write?.path).toContain(
            scope === "single" ? "/instance?" : "/master?"
          );
          expect(write?.path).toContain("sendUpdates=none");
        }).pipe(Effect.provide(serviceLayer(fake)));
      })
  );

  it.effect.prop(
    "RSVP preserves other attendees and changes only self",
    {
      answer: Arbitrary.schema(
        Schema.Literals(["accepted", "declined", "tentative", "needsAction"])
      ),
      note: titleArbitrary,
    },
    ({ answer, note }) =>
      Effect.gen(function* scenario8() {
        const other = {
          email: "other@example.test",
          responseStatus: "accepted",
        };

        const self = {
          email: "owner@example.test",
          responseStatus: "needsAction",
          self: true,
        };

        const fake = yield* fakeGoogle([
          response(
            200,
            timedEvent("meeting", "Meeting", { attendees: [other, self] })
          ),
          response(200, timedEvent("meeting")),
        ]);

        yield* Effect.gen(function* scenario9() {
          const calendar = yield* CalendarService;
          yield* calendar.rsvp({
            ...ref,
            eventId: "meeting",
            note,
            response: answer,
          });
          const requests = yield* Ref.get(fake.requests);

          const body = yield* Schema.decodeEffect(bodySchema)(
            requests[1]?.body ?? ""
          );

          expect(body.attendees).toEqual([
            { ...self, comment: note, responseStatus: answer },
          ]);
          expect(body.attendeesOmitted).toBe(true);
          expect(requests[1]?.path).toContain("sendUpdates=none");
        }).pipe(Effect.provide(serviceLayer(fake)));
      })
  );

  it.effect(
    "count-limited splits count provider-expanded original slots including cancelled slots",
    () =>
      Effect.gen(function* scenario10() {
        const selected = timedEvent("instance", "old", {
          originalStartTime: start,
          recurringEventId: "master",
        });

        const master = timedEvent("master", "old", {
          recurrence: ["RRULE:FREQ=WEEKLY;COUNT=3"],
        });

        const fake = yield* fakeGoogle([
          response(200, selected),
          response(200, master),
          response(200, {
            items: [
              timedEvent("earlier", "old", {
                originalStartTime: { dateTime: "2026-03-08T09:00:00-07:00" },
                status: "cancelled",
              }),
              selected,
            ],
          }),
          response(200, master),
          response(200, timedEvent("abcde")),
          response(200, master),
        ]);

        yield* Effect.gen(function* scenario11() {
          const calendar = yield* CalendarService;
          yield* calendar.updateEvent({
            ...ref,
            changes: { title: "new" },
            eventId: "instance",
            scope: "allFollowing",
          });
          const requests = yield* Ref.get(fake.requests);

          const body = yield* Schema.decodeEffect(bodySchema)(
            requests[4]?.body ?? ""
          );

          expect(body.recurrence).toEqual(["RRULE:FREQ=WEEKLY;COUNT=2"]);
          expect(requests[2]?.path).toContain("/master/instances?");
        }).pipe(Effect.provide(serviceLayer(fake)));
      })
  );

  it.effect("calendar listing follows pages and uses colors.get", () =>
    Effect.gen(function* scenario12() {
      const palette = {
        calendar: { "1": { background: "#ffffff", foreground: "#000000" } },
        event: {},
      };

      const fake = yield* fakeGoogle([
        response(200, palette),
        response(200, {
          items: [
            {
              accessRole: "owner",
              id: "primary",
              summary: "Mine",
              timeZone: "America/Los_Angeles",
            },
          ],
          nextPageToken: "more",
        }),
        response(200, { items: [{ accessRole: "reader", id: "shared" }] }),
      ]);

      yield* Effect.gen(function* scenario13() {
        const calendar = yield* CalendarService;
        const result = yield* calendar.listCalendars();
        const [account] = result.accounts;

        if (account === undefined || !("calendars" in account)) {
          return yield* Effect.die(
            new Error("Expected a successful account result")
          );
        }

        expect(account.calendars.map((item) => item.calendarId)).toEqual([
          "primary",
          "shared",
        ]);
        expect(account.colors).toEqual(palette);
        expect(account.accountId).toBe("account");

        return yield* Effect.void;
      }).pipe(Effect.provide(serviceLayer(fake)));
    })
  );
});

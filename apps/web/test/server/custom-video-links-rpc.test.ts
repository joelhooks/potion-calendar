import {
  AccountConferencingDefault,
  AccountConferencingDefaultFailure,
  CalendarEvent,
  CalendarFailure,
  CustomVideoCatalog,
  CustomVideoFailure,
} from "@calendar/calendar/contracts";
import { expect, layer } from "@effect/vitest";
import { Context, Effect, Layer, Result } from "effect";

import { DevelopmentRuntime } from "../../src/dev/native-runtime.js";
import { settingsRpcFixture } from "./settings-rpc-fixture.js";

class CustomLinkRpc extends Context.Service<
  CustomLinkRpc,
  Effect.Success<typeof settingsRpcFixture>
>()("test/CustomLinkRpc") {}

const fixtureLayer = Layer.effect(CustomLinkRpc, settingsRpcFixture).pipe(
  Layer.provide(
    DevelopmentRuntime.layer("http://127.0.0.1:5173", ["joel@example.test"])
  )
);

const room = {
  id: "rpc-custom-room",
  link: "https://room.example/original",
  name: "Team room",
};

const event = {
  attendees: [{ email: "guest@example.test" }],
  description: "Agenda",
  end: { dateTime: "2026-10-20T11:00:00Z" },
  location: "Office 12",
  start: { dateTime: "2026-10-20T10:00:00Z" },
};

layer(fixtureLayer, { excludeTestServices: true })(
  "authenticated custom-link catalog RPC and native writer",
  (it) => {
    it.effect(
      "an edited account reference supplies the current description URL and a removed reference refuses with zero provider creates",
      () =>
        Effect.gen(function* recipientPath() {
          const fixture = yield* CustomLinkRpc;

          const ref = {
            accountId: fixture.target.accountId,
            calendarId: fixture.target.calendarId,
          };

          const value = { id: room.id, kind: "customLink" };

          const catalog = yield* fixture.success(
            "importCustomVideoLinks",
            { entries: [room] },
            CustomVideoCatalog
          );

          expect(catalog.entries).toContainEqual(room);
          expect(
            yield* fixture.success(
              "setAccountConferencingDefault",
              { accountId: ref.accountId, value },
              AccountConferencingDefault
            )
          ).toEqual({ accountId: ref.accountId, value });

          const edited = {
            ...room,
            link: "https://room.example/edited",
            name: "Edited room",
          };

          yield* fixture.success(
            "saveCustomVideoLink",
            { ...edited, create: false },
            CustomVideoCatalog
          );

          const created = yield* fixture.success(
            "createEvent",
            { ...ref, conferencingRequest: value, event, id: "abcde123" },
            CalendarEvent
          );

          expect(
            created.description,
            "account reference must append its current URL once"
          ).toBe("Agenda\nhttps://room.example/edited");
          expect(created.location).toBe("Office 12");
          expect(created.conference).toBeUndefined();
          expect(created.conferenceUrl).toBeUndefined();
          yield* fixture.success(
            "removeCustomVideoLink",
            { id: room.id },
            CustomVideoCatalog
          );
          expect(
            (yield* fixture.success(
              "getAccountConferencingDefault",
              { accountId: ref.accountId },
              AccountConferencingDefault
            )).value
          ).toBe("none");

          const creates = () =>
            fixture.runtime.outboundRequests.filter(
              (request) =>
                request.method === "POST" && request.path.endsWith("/events")
            ).length;

          const before = creates();

          const refused = yield* fixture
            .failure(
              "createEvent",
              { ...ref, conferencingRequest: value, event, id: "abcde124" },
              CalendarFailure
            )
            .pipe(Effect.result);

          expect(
            creates() - before,
            "removed custom link must produce zero provider creates"
          ).toBe(0);
          expect(
            Result.match(refused, {
              onFailure: () => "unexpectedResponse",
              onSuccess: (error) => error._tag,
            }),
            "removed reference must return a typed refusal"
          ).toBe("Provider");
          expect(
            (yield* fixture.success(
              "importCustomVideoLinks",
              { entries: [room] },
              CustomVideoCatalog
            )).entries.some((entry) => entry.id === room.id)
          ).toBe(false);
        })
    );
    it.effect(
      "the RPC session supplies catalog ownership and refuses foreign custom references without fallback",
      () =>
        Effect.gen(function* personFence() {
          const fixture = yield* CustomLinkRpc;

          const foreign = yield* fixture.runtime.seedPerson([
            "second@example.test",
          ]);

          const headers = new Headers({
            cookie: foreign.cookie,
            origin: fixture.origin,
          });

          const privateEntry = {
            ...room,
            id: "foreign-private-room",
            name: "Private room",
          };

          yield* fixture.success(
            "importCustomVideoLinks",
            { entries: [privateEntry] },
            CustomVideoCatalog,
            headers
          );
          expect(
            (yield* fixture.success(
              "readCustomVideoLinks",
              {},
              CustomVideoCatalog
            )).entries.some((entry) => entry.id === privateEntry.id),
            "another person's catalog must not be returned"
          ).toBe(false);

          const failure = yield* fixture.failure(
            "saveCustomVideoLink",
            { ...privateEntry, create: false, name: "Stolen" },
            CustomVideoFailure
          );

          expect(failure._tag).toBe("Provider");

          const unchanged = yield* fixture.success(
            "readCustomVideoLinks",
            {},
            CustomVideoCatalog,
            headers
          );

          expect(
            unchanged.entries,
            "another person's catalog must not change"
          ).toContainEqual(privateEntry);

          const missing = yield* fixture.failure(
            "setAccountConferencingDefault",
            {
              accountId: fixture.target.accountId,
              value: { id: privateEntry.id, kind: "customLink" },
            },
            AccountConferencingDefaultFailure
          );

          expect(missing._tag).toBe("AccountNotOwned");
        })
    );
  }
);

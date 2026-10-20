import {
  Calendar,
  DisconnectAccountFailure,
  DisconnectAccountResult,
  ListCalendarsOutput,
  SetCalendarAppearanceFailure,
} from "@calendar/calendar/contracts";
import { calendarCacheRepository } from "@calendar/database/calendar-cache";
import { googlePushRepository } from "@calendar/database/google-push";
import { expect, layer } from "@effect/vitest";
import { Clock, Context, Effect, Layer, Result, Schema } from "effect";

import { LiveFrame } from "../../src/client/live/protocol.js";
import { DevelopmentRuntime } from "../../src/dev/native-runtime.js";
import { rpcDocument, rpcFailure, rpcValue } from "./calendar-rpc.js";
import { settingsRpcFixture } from "./settings-rpc-fixture.js";

class SettingsRpc extends Context.Service<
  SettingsRpc,
  Effect.Success<typeof settingsRpcFixture>
>()("test/SettingsRpc") {}

const settingsLayer = (emails?: readonly string[]) =>
  Layer.effect(SettingsRpc, settingsRpcFixture).pipe(
    Layer.provide(DevelopmentRuntime.layer("http://127.0.0.1:5173", emails))
  );

layer(settingsLayer(), { excludeTestServices: true })(
  "appearance RPC",
  (it) => {
    it.effect(
      "Google calendar colours and visibility commit before cache and live notices, and hidden calendars remain listed",
      () =>
        Effect.gen(function* appearanceRoundTrip() {
          const fixture = yield* SettingsRpc;
          const { target, runtime } = fixture;

          const ref = {
            accountId: target.accountId,
            calendarId: target.calendarId,
          };

          const cache = calendarCacheRepository(
            runtime.database,
            runtime.person.personId
          );

          const initialVersion = yield* cache.invalidate(ref);
          const frames = yield* fixture.openFrames;

          const updated = yield* fixture.success(
            "setCalendarAppearance",
            { ...ref, colorId: "2", hidden: true, selected: false },
            Calendar
          );

          expect(updated).toMatchObject({
            ...ref,
            backgroundColor: "#33b679",
            colorId: "2",
            hidden: true,
            selected: false,
          });
          expect((yield* cache.read(ref)).version).toBe(initialVersion + 1);
          expect(yield* frames.next).toEqual({
            ...ref,
            reason: "write",
            version: initialVersion + 1,
          });
          expect(yield* frames.next).toEqual(LiveFrame.members[1].make({}));

          const listing = yield* fixture.success(
            "listCalendars",
            {},
            ListCalendarsOutput
          );

          const listed = listing.accounts.flatMap((account) =>
            "calendars" in account ? account.calendars : []
          );

          expect(
            listed.find(
              (calendar) =>
                calendar.accountId === ref.accountId &&
                calendar.calendarId === ref.calendarId
            )
          ).toMatchObject({ hidden: true, selected: false });
          expect(
            runtime.outboundRequests.findLast(
              (request) => request.method === "PATCH"
            )
          ).toMatchObject({
            colorRgbFormat: null,
            path: `/calendar/v3/users/me/calendarList/${encodeURIComponent(ref.calendarId)}`,
          });
          expect(
            runtime.outboundRequests
              .filter(
                (request) =>
                  request.path === "/calendar/v3/users/me/calendarList"
              )
              .every((request) => request.showHidden === "true")
          ).toBe(true);

          const shown = yield* fixture.success(
            "setCalendarAppearance",
            { ...ref, hidden: false, selected: true },
            Calendar
          );

          expect(shown).toMatchObject({
            backgroundColor: "#33b679",
            colorId: "2",
            hidden: false,
            selected: true,
          });
          yield* frames.barrier(1_000_002);
        })
    );

    it.effect(
      "empty, event-palette-only, and provider-rejected changes leave cache versions and live notices alone",
      () =>
        Effect.gen(function* refusedAppearance() {
          const fixture = yield* SettingsRpc;

          const ref = {
            accountId: fixture.target.accountId,
            calendarId: fixture.target.calendarId,
          };

          const cache = calendarCacheRepository(
            fixture.runtime.database,
            fixture.runtime.person.personId
          );

          const before = yield* cache.read(ref);
          const frames = yield* fixture.openFrames;

          const listing = yield* fixture.success(
            "listCalendars",
            {},
            ListCalendarsOutput
          );

          const account = listing.accounts.find(
            (candidate) => candidate.accountId === ref.accountId
          );

          if (account === undefined || !("colors" in account)) {
            throw new Error("Missing provider palettes");
          }

          expect(account.colors.event["9"]).toBeDefined();
          expect(account.colors.calendar["9"]).toBeUndefined();

          const empty = yield* fixture.failure(
            "setCalendarAppearance",
            ref,
            SetCalendarAppearanceFailure
          );

          expect(empty._tag).toBe("CalendarAppearanceRefused");
          expect(empty).toMatchObject({ reason: "emptyUpdate" });

          const eventOnly = yield* fixture.failure(
            "setCalendarAppearance",
            { ...ref, colorId: "9" },
            SetCalendarAppearanceFailure
          );

          expect(eventOnly._tag).toBe("CalendarAppearanceRefused");
          expect(eventOnly).toMatchObject({ reason: "unknownCalendarColor" });

          const denied = yield* fixture.failure(
            "setCalendarAppearance",
            { ...ref, calendarId: "absent-calendar", selected: false },
            SetCalendarAppearanceFailure
          );

          expect(denied._tag).toBe("NotFound");
          expect(yield* cache.read(ref)).toEqual(before);
          expect(
            yield* cache.read({ ...ref, calendarId: "absent-calendar" })
          ).toEqual({ cursor: null, revision: 0, version: 0 });
          expect(yield* frames.barrier(1_000_003)).toEqual([]);
        })
    );
  }
);

layer(settingsLayer(), { excludeTestServices: true })(
  "disconnect recovery RPC",
  (it) => {
    it.effect(
      "failed D1 deletion rolls back local rows, fences stale work, and retries through notification without revoking Google's shared grant",
      () =>
        Effect.gen(function* disconnectHistory() {
          const fixture = yield* SettingsRpc;
          const { target, runtime } = fixture;

          const ref = {
            accountId: target.accountId,
            calendarId: target.calendarId,
          };

          const other = fixture.calendars.find(
            (calendar) => calendar.accountId !== ref.accountId
          );

          if (other === undefined) {
            throw new Error("Missing remaining account");
          }

          const cache = calendarCacheRepository(
            runtime.database,
            runtime.person.personId
          );

          expect(
            yield* cache.compareAndSwap(ref, 0, {
              cursor: "saved-cursor",
              revision: 1,
              version: 1,
            })
          ).toBe(true);
          expect(
            yield* cache.cacheRange(
              ref,
              "2026-01-01T00:00:00Z",
              "2026-01-02T00:00:00Z",
              1,
              (yield* Clock.currentTimeMillis) + 60_000,
              "[]"
            )
          ).toBe(true);
          const frames = yield* fixture.openFrames;
          const before = yield* fixture.counts(ref.accountId);
          expect(before).toEqual({
            accounts: 1,
            channels: 3,
            ranges: 1,
            snapshots: 1,
          });

          yield* fixture.execute(
            "CREATE TRIGGER fixture_refuse_settings_delete BEFORE DELETE ON account WHEN EXISTS (SELECT 1 FROM calendar_account_disconnect WHERE person_id = OLD.userId AND account_id = OLD.id AND phase = 'stopped') BEGIN SELECT RAISE(ABORT, 'fixture-delete-refusal'); END"
          );

          const failed = yield* fixture.failure(
            "disconnectAccount",
            { accountId: ref.accountId },
            DisconnectAccountFailure
          );

          expect(failed._tag).toBe("Provider");
          expect(yield* fixture.counts(ref.accountId)).toEqual(before);
          expect(yield* fixture.receipt(ref.accountId)).toMatchObject({
            phase: "stopped",
          });
          expect(
            runtime.outboundRequests.filter(
              (request) => request.path === "/calendar/v3/channels/stop"
            )
          ).toHaveLength(3);
          expect(yield* frames.barrier(1_000_004)).toEqual([]);

          const watchCount = runtime.outboundRequests.filter((request) =>
            request.path.endsWith("/watch")
          ).length;

          yield* fixture.live.reconcile(runtime.person.personId);
          expect(
            runtime.outboundRequests.filter((request) =>
              request.path.endsWith("/watch")
            )
          ).toHaveLength(watchCount);
          yield* frames.barrier(1_000_005);
          expect(
            yield* cache.compareAndSwap(ref, 1, {
              cursor: "late-cursor",
              revision: 2,
              version: 2,
            })
          ).toBe(false);
          expect(
            yield* cache.cacheRange(
              ref,
              "late-start",
              "late-end",
              1,
              (yield* Clock.currentTimeMillis) + 60_000,
              "[]"
            )
          ).toBe(false);
          expect(
            Result.isFailure(yield* cache.invalidate(ref).pipe(Effect.result))
          ).toBe(true);

          const blockedChannel = yield* googlePushRepository(runtime.database)
            .insertPending({
              ...ref,
              createdAt: yield* Clock.currentTimeMillis,
              expiresAt: (yield* Clock.currentTimeMillis) + 60_000,
              id: "blocked-channel",
              kind: "events",
              personId: runtime.person.personId,
              predecessorId: null,
              resourceId: null,
              state: "pending",
              tokenHash: "a".repeat(64),
            })
            .pipe(Effect.result);

          expect(Result.isFailure(blockedChannel)).toBe(true);

          yield* fixture.execute("DROP TRIGGER fixture_refuse_settings_delete");

          const disconnected = yield* fixture.success(
            "disconnectAccount",
            { accountId: ref.accountId },
            DisconnectAccountResult
          );

          expect(disconnected).toEqual({
            accountId: ref.accountId,
            disconnected: true,
            instruction:
              "Potion Calendar has forgotten this account. To remove its Google access entirely, use your Google Account's third-party access page.",
            revocation: "notAttempted",
          });
          expect(yield* fixture.counts(ref.accountId)).toEqual({
            accounts: 0,
            channels: 0,
            ranges: 0,
            snapshots: 0,
          });
          expect(yield* fixture.receipt(ref.accountId)).toMatchObject({
            phase: "done",
          });
          expect(yield* frames.next).toEqual(LiveFrame.members[1].make({}));
          expect(
            yield* cache.compareAndSwap(ref, 0, {
              cursor: "resurrected",
              revision: 1,
              version: 1,
            })
          ).toBe(false);
          expect(yield* fixture.counts(ref.accountId)).toEqual({
            accounts: 0,
            channels: 0,
            ranges: 0,
            snapshots: 0,
          });

          const listing = yield* fixture.success(
            "listCalendars",
            {},
            ListCalendarsOutput
          );

          expect(listing.accounts.map((account) => account.accountId)).toEqual([
            other.accountId,
          ]);
          const calls = runtime.outboundRequests.length;
          expect(
            yield* fixture.success(
              "disconnectAccount",
              { accountId: ref.accountId },
              DisconnectAccountResult
            )
          ).toEqual(disconnected);
          expect(runtime.outboundRequests).toHaveLength(calls);

          const last = yield* fixture.failure(
            "disconnectAccount",
            { accountId: other.accountId },
            DisconnectAccountFailure
          );

          expect(last._tag).toBe("LastCalendarAccount");
          expect(last).toMatchObject({ accountId: other.accountId });

          const relinked = yield* runtime.linkAccount(
            target.calendarId,
            runtime.person.cookie
          );

          expect(relinked.personId).toBe(runtime.person.personId);

          const relisted = yield* fixture.success(
            "listCalendars",
            {},
            ListCalendarsOutput,
            new Headers({ cookie: relinked.cookie, origin: fixture.origin })
          );

          expect(relisted.accounts).toHaveLength(2);
          expect(
            relisted.accounts.some(
              (account) => account.accountId === ref.accountId
            )
          ).toBe(false);
          expect(
            yield* fixture.success(
              "disconnectAccount",
              { accountId: ref.accountId },
              DisconnectAccountResult
            )
          ).toEqual(disconnected);
          expect(
            (yield* fixture.success("listCalendars", {}, ListCalendarsOutput))
              .accounts
          ).toHaveLength(2);
          expect(
            runtime.outboundRequests.filter(
              (request) => request.path === "/revoke"
            )
          ).toHaveLength(0);
        })
    );
  }
);

layer(settingsLayer(), { excludeTestServices: true })(
  "concurrent disconnect RPC",
  (it) => {
    it.effect("two tabs cannot disconnect both remaining accounts", () =>
      Effect.gen(function* racingDisconnects() {
        const fixture = yield* SettingsRpc;
        yield* fixture.live.reconcile(fixture.runtime.person.personId);

        const ids = [
          ...new Set(fixture.calendars.map((calendar) => calendar.accountId)),
        ];

        expect(ids).toHaveLength(2);

        const outcome = Schema.Union([
          rpcValue(DisconnectAccountResult),
          rpcFailure(DisconnectAccountFailure),
        ]);

        const documents = yield* Effect.forEach(
          ids,
          (accountId) =>
            rpcDocument(
              fixture.backend,
              "disconnectAccount",
              { accountId },
              fixture.headers
            ).pipe(Effect.flatMap(Schema.decodeUnknownEffect(outcome))),
          { concurrency: 2 }
        );

        const exits = documents.map((document) => document[0].exit);
        expect(exits.filter((exit) => "value" in exit)).toHaveLength(1);

        const refusals = exits.flatMap((exit) =>
          "cause" in exit ? exit.cause.map((cause) => cause.error) : []
        );

        expect(refusals.map((error) => error._tag)).toEqual([
          "LastCalendarAccount",
        ]);

        const remaining = yield* fixture.success(
          "listCalendars",
          {},
          ListCalendarsOutput
        );

        expect(remaining.accounts).toHaveLength(1);
        expect(
          fixture.runtime.outboundRequests.filter(
            (request) => request.path === "/revoke"
          )
        ).toHaveLength(0);
      })
    );
  }
);

const relinkedConnection = Effect.gen(function* relinkedConnection() {
  const fixture = yield* SettingsRpc;
  const googleCalendarId = fixture.target.calendarId;

  const before = yield* fixture.success(
    "listCalendars",
    {},
    ListCalendarsOutput
  );

  const previous = before.accounts
    .flatMap((account) => ("calendars" in account ? account.calendars : []))
    .find((calendar) => calendar.calendarId === googleCalendarId);

  if (previous === undefined) {
    throw new Error("Missing connection before relink");
  }

  const oldRef = {
    accountId: previous.accountId,
    calendarId: previous.calendarId,
  };

  yield* fixture.success(
    "disconnectAccount",
    { accountId: oldRef.accountId },
    DisconnectAccountResult
  );

  const linked = yield* fixture.runtime.linkAccount(
    googleCalendarId,
    fixture.runtime.person.cookie
  );

  const after = yield* fixture.success(
    "listCalendars",
    {},
    ListCalendarsOutput,
    new Headers({ cookie: linked.cookie, origin: fixture.origin })
  );

  const current = after.accounts
    .flatMap((account) => ("calendars" in account ? account.calendars : []))
    .find((calendar) => calendar.calendarId === googleCalendarId);

  if (current === undefined) {
    throw new Error("Missing relinked connection");
  }

  return {
    fixture,
    oldRef,
    personId: linked.personId,
    ref: { accountId: current.accountId, calendarId: current.calendarId },
  };
});

layer(settingsLayer(), { excludeTestServices: true })(
  "relinked connection invariants",
  (it) => {
    it.effect(
      "relinking the same Google identity always mints a fresh connection id",
      () =>
        Effect.gen(function* freshConnectionIdentity() {
          const { fixture, oldRef, personId, ref } = yield* relinkedConnection;
          expect(personId).toBe(fixture.runtime.person.personId);
          expect(ref.calendarId).toBe(oldRef.calendarId);
          expect(ref.accountId).not.toBe(oldRef.accountId);
          expect(yield* fixture.receipt(oldRef.accountId)).toMatchObject({
            phase: "done",
          });
          expect(yield* fixture.receipt(ref.accountId)).toBeNull();
        })
    );

    it.effect(
      "real D1 admits relinked snapshot, range and channel writes while permanently fencing the old connection",
      () =>
        Effect.gen(function* relinkedWrites() {
          const { fixture, oldRef, ref } = yield* relinkedConnection;
          expect(ref.accountId).not.toBe(oldRef.accountId);

          const cache = calendarCacheRepository(
            fixture.runtime.database,
            fixture.runtime.person.personId
          );

          expect(
            yield* cache.compareAndSwap(ref, 0, {
              cursor: "relinked-cursor",
              revision: 1,
              version: 1,
            })
          ).toBe(true);
          expect(
            yield* cache.cacheRange(
              ref,
              "2026-01-01T00:00:00Z",
              "2026-01-02T00:00:00Z",
              1,
              (yield* Clock.currentTimeMillis) + 60_000,
              "[]"
            )
          ).toBe(true);
          yield* fixture.live.reconcile(fixture.runtime.person.personId);
          expect(yield* fixture.counts(ref.accountId)).toEqual({
            accounts: 1,
            channels: 3,
            ranges: 1,
            snapshots: 1,
          });
          expect(yield* cache.read(ref)).toMatchObject({
            cursor: "relinked-cursor",
            revision: 1,
            version: 1,
          });
          expect(
            yield* cache.readRange(
              ref,
              "2026-01-01T00:00:00Z",
              "2026-01-02T00:00:00Z",
              1,
              yield* Clock.currentTimeMillis
            )
          ).toBe("[]");
          expect(
            yield* googlePushRepository(fixture.runtime.database).active(
              fixture.runtime.person.personId,
              { ...ref, kind: "events" }
            )
          ).toMatchObject({ accountId: ref.accountId, state: "active" });
          expect(
            yield* cache.compareAndSwap(oldRef, 0, {
              cursor: "stale",
              revision: 1,
              version: 1,
            })
          ).toBe(false);
          expect(
            yield* cache.cacheRange(
              oldRef,
              "late-start",
              "late-end",
              0,
              (yield* Clock.currentTimeMillis) + 60_000,
              "[]"
            )
          ).toBe(false);
          expect(yield* fixture.counts(oldRef.accountId)).toEqual({
            accounts: 0,
            channels: 0,
            ranges: 0,
            snapshots: 0,
          });
        })
    );
  }
);

layer(settingsLayer(["joel@example.test"]), { excludeTestServices: true })(
  "settings ownership RPC",
  (it) => {
    it.effect(
      "foreign accounts refuse before channel or provider work and an owned final account stays linked",
      () =>
        Effect.gen(function* ownedSettingsOnly() {
          const fixture = yield* SettingsRpc;

          const foreign = yield* fixture.runtime.seedPerson([
            "second@example.test",
          ]);

          const listing = yield* fixture.success(
            "listCalendars",
            {},
            ListCalendarsOutput,
            new Headers({ cookie: foreign.cookie, origin: fixture.origin })
          );

          const [account] = listing.accounts;

          if (account === undefined) {
            throw new Error("Missing foreign account");
          }

          const foreignCalendar =
            "calendars" in account ? account.calendars[0] : undefined;

          if (foreignCalendar === undefined) {
            throw new Error("Missing foreign calendar");
          }

          const calls = fixture.runtime.outboundRequests.length;

          const appearance = yield* fixture.failure(
            "setCalendarAppearance",
            {
              accountId: account.accountId,
              calendarId: foreignCalendar.calendarId,
              selected: false,
            },
            SetCalendarAppearanceFailure
          );

          expect(appearance._tag).toBe("NotConnected");
          expect(appearance).toMatchObject({ accountId: account.accountId });

          const removal = yield* fixture.failure(
            "disconnectAccount",
            { accountId: account.accountId },
            DisconnectAccountFailure
          );

          expect(removal._tag).toBe("AccountNotOwned");
          expect(removal).toMatchObject({ accountId: account.accountId });

          const final = yield* fixture.failure(
            "disconnectAccount",
            { accountId: fixture.target.accountId },
            DisconnectAccountFailure
          );

          expect(final._tag).toBe("LastCalendarAccount");
          expect(final).toMatchObject({ accountId: fixture.target.accountId });
          expect(fixture.runtime.outboundRequests).toHaveLength(calls);
          expect((yield* fixture.counts(account.accountId)).accounts).toBe(0);
          expect(
            (yield* fixture.counts(fixture.target.accountId)).accounts
          ).toBe(1);

          const stillOwned = yield* fixture.success(
            "listCalendars",
            {},
            ListCalendarsOutput,
            new Headers({ cookie: foreign.cookie, origin: fixture.origin })
          );

          expect(
            stillOwned.accounts.map((candidate) => candidate.accountId)
          ).toEqual([account.accountId]);
        })
    );
  }
);

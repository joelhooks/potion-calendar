import type { EventFieldsValue } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Ref, Result, Schema } from "effect";
import { FetchHttpClient } from "effect/http";

import {
  ref,
  response,
  timedEvent,
} from "../../../packages/calendar/test/fake-google.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { editingRpcFixture, writeBody } from "./editing-rpc-fixture.js";

const modes = {
  all: "declineAllConflictingInvitations",
  new: "declineOnlyNewConflictingInvitations",
  none: "declineNone",
} as const;

it.effect.prop(
  "status-property RPC writes require matching type, a supported saved policy, owner identity, primary writability and no invitation updates",
  {
    matching: Schema.Boolean,
    mode: Schema.Literals(["none", "new", "all"]),
    on: Schema.Boolean,
    organizer: Schema.Boolean,
    primary: Schema.Boolean,
    role: Schema.Literals(["owner", "writer", "reader"]),
    sendAll: Schema.Boolean,
    type: Schema.Literals(["focusTime", "outOfOffice"]),
  },
  ({ type, mode, role, primary, organizer, matching, sendAll, on }) =>
    Effect.gen(function* statusPropertyBoundary() {
      const sourceProperties = { autoDeclineMode: modes[mode] };

      const source = timedEvent("status-event", "Status", {
        eventType: type,
        organizer: { self: organizer },
        ...(type === "focusTime"
          ? { focusTimeProperties: sourceProperties }
          : { outOfOfficeProperties: sourceProperties }),
      });

      const acceptedInput = mode !== "all" && matching && !sendAll;

      const permitted =
        acceptedInput && role === "owner" && primary && organizer;

      const opposite = {
        focusTime: "outOfOffice",
        outOfOffice: "focusTime",
      } as const;

      const target = matching ? type : opposite[type];

      const properties = {
        autoDeclineMode: on
          ? "declineOnlyNewConflictingInvitations"
          : "declineNone",
      } satisfies NonNullable<EventFieldsValue["outOfOfficeProperties"]>;

      const changes: EventFieldsValue =
        target === "focusTime"
          ? { focusTimeProperties: properties }
          : { outOfOfficeProperties: properties };

      const key =
        type === "focusTime" ? "focusTimeProperties" : "outOfOfficeProperties";

      const api = yield* editingRpcFixture([
        response(200, source),
        ...(acceptedInput
          ? [response(200, { accessRole: role, id: ref.calendarId, primary })]
          : []),
        ...(permitted ? [response(200, { ...source, [key]: properties })] : []),
      ]);

      const result = yield* CalendarEditingClient.use((client) =>
        client.updateEvent({
          ...ref,
          changes,
          eventId: "status-event",
          scope: "single",
          sendUpdates: sendAll ? "all" : "none",
        })
      ).pipe(
        Effect.provide(CalendarEditingClient.layer("notAvailable")),
        Effect.provideService(FetchHttpClient.Fetch, api.fetcher),
        Effect.result
      );

      expect(Result.isSuccess(result)).toBe(permitted);
      const receipts = yield* Ref.get(api.fake.receipts);

      const patches = receipts.filter(
        (receipt) => receipt.request.method === "PATCH"
      );

      expect(patches).toHaveLength(permitted ? 1 : 0);
      expect(
        receipts.filter((receipt) => receipt.request.method === "POST")
      ).toHaveLength(0);

      if (permitted) {
        expect(patches[0]?.request.path).toBe(
          "/calendars/calendar/events/status-event?sendUpdates=none"
        );
        expect(writeBody(patches[0]?.request.body)).toEqual(changes);
      }
    })
);

it.effect.each(["focusTime", "outOfOffice"] as const)(
  "a saved %s policy is not rewritten with unpicked fields or an unrepresented value",
  (type) =>
    Effect.gen(function* rejectUnpickedPolicy() {
      for (const mode of [
        "declineNone",
        "declineAllConflictingInvitations",
      ] as const) {
        const properties = { autoDeclineMode: mode };

        const source = timedEvent("status-event", "Status", {
          eventType: type,
          organizer: { self: true },
          ...(type === "focusTime"
            ? { focusTimeProperties: properties }
            : { outOfOfficeProperties: properties }),
        });

        const api = yield* editingRpcFixture([response(200, source)]);

        const requested = {
          autoDeclineMode: "declineNone",
          declineMessage: "Unpicked response",
        } satisfies NonNullable<EventFieldsValue["outOfOfficeProperties"]>;

        const changes =
          type === "focusTime"
            ? {
                focusTimeProperties: {
                  ...requested,
                  chatStatus: "doNotDisturb" as const,
                },
              }
            : { outOfOfficeProperties: requested };

        const result = yield* CalendarEditingClient.use((client) =>
          client.updateEvent({
            ...ref,
            changes,
            eventId: "status-event",
            scope: "single",
            sendUpdates: "none",
          })
        ).pipe(
          Effect.provide(CalendarEditingClient.layer("notAvailable")),
          Effect.provideService(FetchHttpClient.Fetch, api.fetcher),
          Effect.result
        );

        expect(Result.isFailure(result)).toBe(true);
        expect(
          (yield* Ref.get(api.fake.receipts)).filter(
            (receipt) => receipt.request.method === "PATCH"
          )
        ).toHaveLength(0);
      }
    })
);

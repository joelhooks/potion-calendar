import { ConferencingDefault } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { AsyncData } from "foldkit";

import { initialModel, Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import {
  ConferencingChange,
  RemoteConferencingDefault,
} from "../src/client/conferencing/model.js";
import { changeConferencing } from "../src/client/conferencing/update.js";

const base = (): AppModel => ({
  ...initialModel(0, "UTC"),
  person: Option.some("person-a"),
});

const preference = (model: AppModel, accountId = "account-a") =>
  Option.getOrUndefined(
    AsyncData.getData(
      model.conferencing.accounts[accountId]?.remote ??
        RemoteConferencingDefault.Idle()
    )
  )?.value;

it.effect.prop(
  "only the newest issued read can settle an account, independent of response order",
  {
    reverse: Schema.Boolean,
    values: Schema.Array(ConferencingDefault).check(
      Schema.isMinLength(2),
      Schema.isMaxLength(8)
    ),
  },
  ({ reverse, values }) =>
    Effect.sync(() => {
      let model = base();
      const responses: (typeof ConferencingChange.Type)[] = [];

      for (const value of values) {
        const next = changeConferencing(
          model,
          ConferencingChange.cases.Load.make({
            accountId: "account-a",
            refresh: true,
          })
        );

        expect(next.commands).toHaveLength(1);
        ({ model } = next);
        responses.push(
          ConferencingChange.cases.Received.make({
            accountId: "account-a",
            personId: "person-a",
            requestId: model.conferencing.nextRequestId,
            result: { accountId: "account-a", value },
          })
        );
      }

      for (const response of reverse ? responses.toReversed() : responses) {
        ({ model } = changeConferencing(model, response));
      }

      expect(preference(model)).toBe(values.at(-1));
      expect(model.conferencing.nextRequestId).toBe(values.length);
      expect(model.conferencing.accounts["account-b"]).toBeUndefined();
    })
);

it.effect(
  "a refresh cannot race a pending write; an unconfirmed write retains old data until an authoritative reload",
  () =>
    Effect.sync(() => {
      const first = changeConferencing(
        base(),
        ConferencingChange.cases.Load.make({
          accountId: "account-a",
          refresh: false,
        })
      );

      const loaded = changeConferencing(
        first.model,
        ConferencingChange.cases.Received.make({
          accountId: "account-a",
          personId: "person-a",
          requestId: first.model.conferencing.nextRequestId,
          result: { accountId: "account-a", value: "none" },
        })
      ).model;

      const write = changeConferencing(
        loaded,
        ConferencingChange.cases.Set.make({
          accountId: "account-a",
          value: "googleMeet",
        })
      );

      const refresh = changeConferencing(
        write.model,
        ConferencingChange.cases.Load.make({
          accountId: "account-a",
          refresh: true,
        })
      );

      expect(refresh.model).toBe(write.model);
      expect(refresh.commands ?? []).toHaveLength(0);
      expect(preference(write.model)).toBe("none");

      const failed = changeConferencing(
        write.model,
        ConferencingChange.cases.Failed.make({
          accountId: "account-a",
          personId: "person-a",
          problem: { message: "Could not confirm the change" },
          requestId: write.model.conferencing.nextRequestId,
        })
      ).model;

      expect(preference(failed)).toBe("none");
      expect(
        AsyncData.hasError(
          failed.conferencing.accounts["account-a"]?.remote ??
            RemoteConferencingDefault.Idle()
        )
      ).toBe(true);

      const reloaded = changeConferencing(
        failed,
        ConferencingChange.cases.Load.make({
          accountId: "account-a",
          refresh: true,
        })
      );

      const confirmed = changeConferencing(
        reloaded.model,
        ConferencingChange.cases.Received.make({
          accountId: "account-a",
          personId: "person-a",
          requestId: reloaded.model.conferencing.nextRequestId,
          result: { accountId: "account-a", value: "googleMeet" },
        })
      ).model;

      expect(preference(confirmed)).toBe("googleMeet");

      const oldReply = changeConferencing(
        confirmed,
        ConferencingChange.cases.Received.make({
          accountId: "account-a",
          personId: "person-a",
          requestId: write.model.conferencing.nextRequestId,
          result: { accountId: "account-a", value: "none" },
        })
      );

      expect(oldReply.model).toBe(confirmed);
    })
);

it.effect(
  "responses are scoped to the initiating person and connection, not only a request number",
  () =>
    Effect.sync(() => {
      const read = changeConferencing(
        base(),
        ConferencingChange.cases.Load.make({
          accountId: "account-a",
          refresh: false,
        })
      ).model;

      const foreign = changeConferencing(
        read,
        ConferencingChange.cases.Received.make({
          accountId: "account-a",
          personId: "person-b",
          requestId: read.conferencing.nextRequestId,
          result: { accountId: "account-a", value: "googleMeet" },
        })
      );

      expect(foreign.model).toBe(read);

      const mismatch = changeConferencing(
        read,
        ConferencingChange.cases.Received.make({
          accountId: "account-a",
          personId: "person-a",
          requestId: read.conferencing.nextRequestId,
          result: { accountId: "account-b", value: "googleMeet" },
        })
      ).model;

      expect(preference(mismatch)).toBeUndefined();
      expect(mismatch.conferencing.accounts["account-b"]).toBeUndefined();
      expect(
        AsyncData.hasError(
          mismatch.conferencing.accounts["account-a"]?.remote ??
            RemoteConferencingDefault.Idle()
        )
      ).toBe(true);
    })
);

it.effect(
  "logout and same-person reauthentication cannot reuse a live request id",
  () =>
    Effect.sync(() => {
      const old = changeConferencing(
        base(),
        ConferencingChange.cases.Load.make({
          accountId: "account-a",
          refresh: false,
        })
      ).model;

      const signedOut = update(
        old,
        Message.ReceivedSession({ snapshot: null })
      ).model;

      const authenticated = update(
        signedOut,
        Message.ReceivedSession({
          snapshot: {
            accounts: [
              {
                disconnected: false,
                email: "owner@example.test",
                id: "account-a",
              },
            ],
            user: {
              email: "owner@example.test",
              id: "person-a",
              name: "Owner",
            },
          },
        })
      ).model;

      const signedIn = changeConferencing(
        authenticated,
        ConferencingChange.cases.Load.make({
          accountId: "account-a",
          refresh: false,
        })
      ).model;

      expect(signedIn.conferencing.nextRequestId).toBeGreaterThan(
        old.conferencing.nextRequestId
      );

      const stale = changeConferencing(
        signedIn,
        ConferencingChange.cases.Received.make({
          accountId: "account-a",
          personId: "person-a",
          requestId: old.conferencing.nextRequestId,
          result: { accountId: "account-a", value: "googleMeet" },
        })
      );

      expect(stale.model).toBe(signedIn);
      expect(preference(stale.model)).toBeUndefined();
    })
);

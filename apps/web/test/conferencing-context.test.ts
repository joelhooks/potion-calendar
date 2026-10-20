import { ConferencingDefault } from "@calendar/calendar/conferencing";
import { expect, it } from "@effect/vitest";
import { Effect, Match, Option, Schema } from "effect";

import { initialModel, RemoteSession } from "../src/client/app.js";
import { editorConferencingContext } from "../src/client/conferencing/editor-context.js";
import { RemoteConferencingDefault } from "../src/client/conferencing/model.js";

it.effect.prop(
  "editor defaults use only the current person's authenticated accounts and fresh matching server preferences",
  {
    disconnected: Schema.Boolean,
    personMatches: Schema.Boolean,
    phase: Schema.Literals([
      "success",
      "refreshing",
      "stale",
      "loading",
      "failure",
      "idle",
    ]),
    value: ConferencingDefault,
    wrongAccount: Schema.Boolean,
  },
  ({ disconnected, personMatches, phase, value, wrongAccount }) =>
    Effect.sync(() => {
      const data = {
        accountId: wrongAccount ? "other-account" : "account-a",
        value,
      };

      const remote = Match.value(phase).pipe(
        Match.when("success", () =>
          RemoteConferencingDefault.Success({ data })
        ),
        Match.when("refreshing", () =>
          RemoteConferencingDefault.Refreshing({ data })
        ),
        Match.when("stale", () =>
          RemoteConferencingDefault.Stale({
            data,
            error: { message: "Unconfirmed choice" },
          })
        ),
        Match.when("loading", () => RemoteConferencingDefault.Loading()),
        Match.when("failure", () =>
          RemoteConferencingDefault.Failure({
            error: { message: "Unavailable" },
          })
        ),
        Match.when("idle", () => RemoteConferencingDefault.Idle()),
        Match.exhaustive
      );

      const model = {
        ...initialModel(0, "UTC"),
        conferencing: {
          accounts: {
            "account-a": { operation: "read", remote, requestId: 1 },
            ghost: {
              operation: "read",
              remote: RemoteConferencingDefault.Success({
                data: { accountId: "ghost", value: "googleMeet" },
              }),
              requestId: 2,
            },
          },
          nextRequestId: 2,
        },
        person: Option.some(personMatches ? "person-a" : "person-b"),
        session: RemoteSession.Success({
          data: {
            accounts: [
              { disconnected, email: "owner@example.test", id: "account-a" },
            ],
            user: {
              email: "owner@example.test",
              id: "person-a",
              name: "Owner",
            },
          },
        }),
      } as const;

      const context = editorConferencingContext(model);

      if (!personMatches) {
        expect(context.accounts).toEqual([]);

        return;
      }

      expect(context.accounts).toHaveLength(1);
      expect(context.accounts[0]).toMatchObject({
        accountId: "account-a",
        email: "owner@example.test",
      });
      const usable = !disconnected && !wrongAccount && phase === "success";
      expect(context.accounts[0]?.setting).toBe(usable ? value : undefined);
    })
);

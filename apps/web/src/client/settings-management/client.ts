import {
  DisconnectAccountFailure,
  SetCalendarAppearanceFailure,
} from "@calendar/calendar/contracts";
import {
  Context,
  Effect,
  Layer,
  Match,
  Option,
  Predicate,
  Schema,
} from "effect";
import { RpcClient } from "effect/rpc";

import { browserGroup, protocol } from "../rpc.js";
import type { ManagementProblem, ManagementTask } from "./model.js";
import { ManagementValue } from "./model.js";

const KnownFailure = Schema.Union([
  DisconnectAccountFailure,
  SetCalendarAppearanceFailure,
]);

const perform = Effect.fn("SettingsManagementClient.perform")(
  function* perform(task: typeof ManagementTask.Type) {
    const client = yield* RpcClient.make(browserGroup);

    return yield* Match.value(task).pipe(
      Match.tag("Colour", ({ accountId, calendarId, colorId }) =>
        client
          .setCalendarAppearance({ accountId, calendarId, colorId })
          .pipe(
            Effect.map((calendar) =>
              ManagementValue.cases.Colour.make({ calendar })
            )
          )
      ),
      Match.tag("Remove", ({ accountId }) =>
        client
          .disconnectAccount({ accountId })
          .pipe(
            Effect.map((result) =>
              ManagementValue.cases.Removed.make({ result })
            )
          )
      ),
      Match.exhaustive
    );
  },
  Effect.provide(protocol),
  Effect.scoped,
  Effect.mapError((failure): typeof ManagementProblem.Type => {
    const known = Schema.decodeUnknownOption(KnownFailure)(failure);

    if (Option.isSome(known)) {
      if (Predicate.isTagged(known.value, "LastCalendarAccount")) {
        return {
          kind: "lastAccount",
          message:
            "Keep at least one connected Google account. Add another account before removing this one.",
        };
      }

      if (Predicate.isTagged(known.value, "AccountNotOwned")) {
        return {
          kind: "notOwned",
          message:
            "This account is not connected to your current sign-in. Refresh accounts to check.",
        };
      }

      if (Predicate.isTagged(known.value, "CalendarAppearanceRefused")) {
        return {
          kind: "refused",
          message: "This color change was refused. The saved color is shown.",
        };
      }
    }

    return {
      kind: "unconfirmed",
      message:
        "The change could not be confirmed. Check your connection and refresh accounts before trying again.",
    };
  })
);

export class SettingsManagementClient extends Context.Service<
  SettingsManagementClient,
  {
    readonly perform: (
      task: typeof ManagementTask.Type
    ) => Effect.Effect<
      typeof ManagementValue.Type,
      typeof ManagementProblem.Type
    >;
  }
>()("calendar/web/SettingsManagementClient") {
  static readonly layer = Layer.succeed(SettingsManagementClient, { perform });
}

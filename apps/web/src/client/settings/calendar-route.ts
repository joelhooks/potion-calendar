import { Option, Predicate } from "effect";
import { AsyncData } from "foldkit";

import { AccountSettingsRoute, SettingsRoute } from "../../layout/route.js";
import type { Route } from "../../layout/route.js";
import type { AppModel } from "../app.js";

export const calendarSettingsTarget = (
  model: AppModel,
  route: typeof Route.Type
): typeof Route.Type => {
  if (!Predicate.isTagged(route, "Settings") || route.page !== "calendars") {
    return route;
  }

  return Option.match(AsyncData.getData(model.session), {
    onNone: () => route,
    onSome: (session) => {
      const account = session?.accounts[0];

      return account === undefined
        ? SettingsRoute.make({ page: "general" })
        : AccountSettingsRoute.make({ accountId: account.id });
    },
  });
};

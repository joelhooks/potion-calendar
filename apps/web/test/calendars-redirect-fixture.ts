import { Option } from "effect";
import { AsyncData } from "foldkit";

import { Message, RemoteSession, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { SettingsRoute } from "../src/layout/route.js";
import { fixtureModel } from "./fixture.js";

export const calendarsRedirectSnapshot = () => {
  const session = Option.getOrThrow(AsyncData.getData(fixtureModel().session));

  return Option.getOrThrow(Option.fromNullishOr(session));
};

export const calendarsRedirectFixture = (
  scene: "account" | "general" | "reconnect" = "account",
  theme: AppModel["settings"]["theme"] = "light"
): AppModel => {
  const base = fixtureModel();
  const snapshot = calendarsRedirectSnapshot();

  const accounts =
    scene === "general"
      ? []
      : snapshot.accounts.map((account) => ({
          ...account,
          disconnected: scene === "reconnect" || account.disconnected,
        }));

  const model = {
    ...base,
    session: RemoteSession.Success({ data: { ...snapshot, accounts } }),
    settings: { ...base.settings, theme },
  };

  return update(
    model,
    Message.RequestedRoute({
      replace: false,
      route: SettingsRoute.make({ page: "calendars" }),
    })
  ).model;
};

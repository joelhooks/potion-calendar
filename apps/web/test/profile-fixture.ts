import { Option } from "effect";
import { AsyncData } from "foldkit";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import {
  ProfileChange,
  ProfileReply,
  profileSaveFailureMessage,
} from "../src/client/settings/profile/model.js";
import { SettingsRoute } from "../src/layout/route.js";
import { fixtureModel } from "./fixture.js";

export const profileSnapshot = (model: AppModel) =>
  Option.getOrThrow(
    Option.fromNullishOr(Option.getOrThrow(AsyncData.getData(model.session)))
  );

export const profileChange = (
  model: AppModel,
  change: typeof ProfileChange.Type
) =>
  update(
    model,
    Message.ChangedProfile({
      change,
      personId: Option.getOrElse(model.person, () => ""),
    })
  );

export const profileFixture = (
  scene: "pristine" | "invalid" | "saving" | "failure" | "discard" = "pristine",
  width = 900,
  theme: AppModel["settings"]["theme"] = "light"
): AppModel => {
  const base = fixtureModel();

  const source = {
    ...base,
    calendar: { ...base.calendar, viewportWidth: width },
    settings: { ...base.settings, theme },
  };

  const measured = update(
    source,
    Message.MeasuredShellViewport({ width })
  ).model;

  const opened = update(
    measured,
    Message.RequestedRoute({
      replace: false,
      route: SettingsRoute.make({ page: "profile" }),
    })
  ).model;

  const { model } = update(
    opened,
    Message.ProfileCompleted({
      personId: Option.getOrThrow(opened.person),
      reply: ProfileReply.cases.Loaded.make({
        snapshot: profileSnapshot(opened),
      }),
      sequence: opened.profile.sequence,
    })
  );

  if (scene === "pristine") {
    return model;
  }

  const edited = profileChange(
    model,
    ProfileChange.cases.Name.make({
      value: scene === "invalid" ? "   " : "Updated Person",
    })
  ).model;

  if (scene === "discard") {
    return update(
      edited,
      Message.RequestedRoute({
        replace: false,
        route: SettingsRoute.make({ page: "general" }),
      })
    ).model;
  }

  const requested = profileChange(
    edited,
    ProfileChange.cases.Save.make({})
  ).model;

  return scene === "failure"
    ? update(
        requested,
        Message.ProfileCompleted({
          personId: Option.getOrThrow(requested.person),
          reply: ProfileReply.cases.Failed.make({
            message: profileSaveFailureMessage,
          }),
          sequence: requested.profile.sequence,
        })
      ).model
    : requested;
};

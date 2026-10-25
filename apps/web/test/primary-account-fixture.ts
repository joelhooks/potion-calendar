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
import { profileChange, profileSnapshot } from "./profile-fixture.js";

export const primaryAccountFixture = (
  scene: "one" | "two" | "disabled" | "saving" | "failure" = "two",
  width = 900,
  theme: AppModel["settings"]["theme"] = "light"
): AppModel => {
  const base = fixtureModel();
  const original = profileSnapshot(base);

  const accounts = original.accounts
    .filter((account) => !account.disconnected)
    .slice(0, scene === "one" ? 1 : 2)
    .map((account) => ({
      ...account,
      disconnected: scene === "disabled" && account.id === "personal",
    }));

  const snapshot = {
    ...original,
    accounts,
    profileUpdateProof: "a".repeat(64),
    user: {
      ...original.user,
      primaryAccountId: scene === "disabled" ? "personal" : "work",
    },
  };

  const source = {
    ...base,
    calendar: { ...base.calendar, viewportWidth: width },
    session: AsyncData.Success({ data: snapshot }),
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

  const loaded = update(
    opened,
    Message.ProfileCompleted({
      personId: Option.getOrThrow(opened.person),
      reply: ProfileReply.cases.Loaded.make({ snapshot }),
      sequence: opened.profile.sequence,
    })
  ).model;

  if (scene !== "saving" && scene !== "failure") {
    return loaded;
  }

  const edited = profileChange(
    loaded,
    ProfileChange.cases.Primary.make({ accountId: "personal" })
  ).model;

  const saving = profileChange(edited, ProfileChange.cases.Save.make({})).model;

  return scene === "saving"
    ? saving
    : update(
        saving,
        Message.ProfileCompleted({
          personId: Option.getOrThrow(saving.person),
          reply: ProfileReply.cases.Failed.make({
            message: profileSaveFailureMessage,
          }),
          sequence: saving.profile.sequence,
        })
      ).model;
};

import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";
import { Scene } from "foldkit/test";

import { Message, update } from "../src/client/app.js";
import { ReadPreferences, SavePreferences } from "../src/client/commands.js";
import { DispatchEditing } from "../src/client/editing/commands.js";
import { PrepareEditingDialogs } from "../src/client/editing/dialog-mount.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { PrepareKeyboard } from "../src/client/keyboard/mount.js";
import {
  normalizePreferences,
  SettingsChange,
  UpcomingMeetingMinutes,
} from "../src/client/settings/model.js";
import { preferenceSnapshot } from "../src/client/settings/update.js";
import { view } from "../src/features/app.js";
import { SettingsRoute } from "../src/layout/route.js";
import { fixtureModel } from "./fixture.js";

it.effect.prop(
  "all six context horizons round-trip per person without dropping existing preferences",
  { minutes: UpcomingMeetingMinutes },
  ({ minutes }) =>
    Effect.gen(function* savedMeetingHorizon() {
      localStorage.clear();
      expect(normalizePreferences({ hidden: [] }).upcomingMeetingMinutes).toBe(
        240
      );
      const base = fixtureModel();
      const person = Option.getOrThrow(base.person);

      const changed = update(
        base,
        Message.ChangedSettings({
          change: SettingsChange.cases.UpcomingMeeting.make({ minutes }),
        })
      ).model;

      expect(changed.settings.upcomingMeetingMinutes).toBe(minutes);
      expect(preferenceSnapshot(changed)).toEqual({
        ...preferenceSnapshot(base),
        upcomingMeetingMinutes: minutes,
      });
      yield* SavePreferences({ ...preferenceSnapshot(changed), person }).effect;

      const reloaded = update(
        base,
        yield* ReadPreferences({ person }).effect
      ).model;

      expect(preferenceSnapshot(reloaded)).toEqual(preferenceSnapshot(changed));
      expect(
        yield* ReadPreferences({ person: "another-meeting-person" }).effect
      ).toEqual(
        Message.ReceivedPreferences({
          person: "another-meeting-person",
          preferences: normalizePreferences({ version: 2, visibility: {} }),
        })
      );
      localStorage.clear();
    })
);

it.effect(
  "General exposes the exact context horizon choices and a saved Always selection",
  () =>
    Effect.gen(function* contextChoices() {
      Scene.scene(
        { update, view },
        Scene.given({
          ...fixtureModel(),
          route: SettingsRoute.make({ page: "general" }),
        }),
        Scene.Mount.resolve(PrepareKeyboard, Message.KeyboardClose()),
        Scene.Mount.resolve(
          PrepareEditingDialogs,
          Message.EditingAction({ action: EditorAction.cases.Cancel.make({}) })
        ),
        Scene.Command.resolve(DispatchEditing, Message.DispatchedEditing()),
        Scene.expect(Scene.selector("#settings-upcoming-meeting")).toHaveValue(
          "240"
        ),
        Scene.change(Scene.selector("#settings-upcoming-meeting"), "10080"),
        Scene.Command.resolve(SavePreferences, Message.SavedPreferences()),
        Scene.expect(Scene.selector("#settings-upcoming-meeting")).toHaveValue(
          "10080"
        )
      );

      const rendered = yield* renderToString(
        {
          init: () => ({
            model: {
              ...fixtureModel(),
              route: SettingsRoute.make({ page: "general" }),
            },
          }),
          view,
        },
        { isHydratable: false }
      );

      const dom = new DOMParser().parseFromString(rendered.html, "text/html");

      const options = [
        ...dom.querySelectorAll("#settings-upcoming-meeting option"),
      ];

      expect(options.map((option) => option.getAttribute("value"))).toEqual([
        "30",
        "60",
        "240",
        "480",
        "720",
        "10080",
      ]);
      expect(options.at(-1)?.textContent).toBe("Always");
    })
);

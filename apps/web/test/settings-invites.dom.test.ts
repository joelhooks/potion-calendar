import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { Scene } from "foldkit/test";

import { Message, update } from "../src/client/app.js";
import { ReadPreferences, SavePreferences } from "../src/client/commands.js";
import { DispatchEditing } from "../src/client/editing/commands.js";
import { PrepareEditingDialogs } from "../src/client/editing/dialog-mount.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { PrepareKeyboard } from "../src/client/keyboard/mount.js";
import {
  SettingsChange,
  normalizePreferences,
} from "../src/client/settings/model.js";
import { preferenceSnapshot } from "../src/client/settings/update.js";
import { view } from "../src/features/app.js";
import { SettingsRoute } from "../src/layout/route.js";
import { fixtureModel } from "./fixture.js";

it.effect.prop(
  "Event invites defaults On for legacy records and preserves an explicit per-person choice",
  { enabled: Schema.Boolean },
  ({ enabled }) =>
    Effect.gen(function* inviteChoice() {
      localStorage.clear();
      expect(normalizePreferences({ hidden: [] }).eventInvites).toBe(true);
      const base = fixtureModel();
      const person = Option.getOrThrow(base.person);

      const changed = update(
        base,
        Message.ChangedSettings({
          change: SettingsChange.cases.EventInvites.make({ enabled }),
        })
      );

      expect(changed.model.settings.eventInvites).toBe(enabled);
      expect(
        changed.commands?.find((command) => command.name === "SavePreferences")
          ?.args
      ).toMatchObject({ ...preferenceSnapshot(base), eventInvites: enabled });
      yield* SavePreferences({ ...preferenceSnapshot(changed.model), person })
        .effect;

      const reloaded = update(
        base,
        yield* ReadPreferences({ person }).effect
      ).model;

      expect(preferenceSnapshot(reloaded)).toEqual(
        preferenceSnapshot(changed.model)
      );
      expect(
        yield* ReadPreferences({ person: "unrelated-person" }).effect
      ).toEqual(
        Message.ReceivedPreferences({
          person: "unrelated-person",
          preferences: normalizePreferences({ version: 2, visibility: {} }),
        })
      );
      localStorage.clear();
    })
);

it.effect(
  "Notifications has its three scoped rows and the Event invites control sends the preference action",
  () =>
    Effect.sync(() => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...fixtureModel(),
          route: SettingsRoute.make({ page: "notifications" }),
        }),
        Scene.Mount.resolve(PrepareKeyboard, Message.KeyboardClose()),
        Scene.Mount.resolve(
          PrepareEditingDialogs,
          Message.EditingAction({ action: EditorAction.cases.Cancel.make({}) })
        ),
        Scene.Command.resolve(DispatchEditing, Message.DispatchedEditing()),
        Scene.expect(
          Scene.role("heading", { name: "Browser notifications" })
        ).toExist(),
        Scene.expect(
          Scene.role("heading", { name: "Default event reminders" })
        ).toExist(),
        Scene.expect(Scene.selector("#settings-event-invites")).toHaveValue(
          "on"
        ),
        Scene.change(Scene.selector("#settings-event-invites"), "off"),
        Scene.Command.resolve(SavePreferences, Message.SavedPreferences()),
        Scene.expect(Scene.selector("#settings-event-invites")).toHaveValue(
          "off"
        ),
        Scene.expect(Scene.selector(".workspace")).toBeAbsent()
      );
    })
);

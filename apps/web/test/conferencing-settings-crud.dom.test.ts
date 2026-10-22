import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Scene } from "foldkit/test";

import { Message, update } from "../src/client/app.js";
import { DispatchEditing } from "../src/client/editing/commands.js";
import { PrepareEditingDialogs } from "../src/client/editing/dialog-mount.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { PrepareKeyboard } from "../src/client/keyboard/mount.js";
import { SaveCustomVideoLinks } from "../src/client/settings/conferencing/commands.js";
import { ConferencingSettingsChange as Change } from "../src/client/settings/conferencing/model.js";
import { view } from "../src/features/app.js";
import { SettingsRoute } from "../src/layout/route.js";
import { fixtureModel } from "./fixture.js";

const rejectedLinkScheme = "javascript";

const fixture = () => ({
  ...fixtureModel(),
  route: SettingsRoute.make({ page: "conferencing" }),
});

it.effect(
  "the actual Settings recipient adds, cancels edits, edits, retains a failed removal and removes after success",
  () =>
    Effect.sync(() => {
      const model = fixture();
      const personId = Option.getOrThrow(model.person);

      const entry = {
        id: "room-one",
        link: "https://room.example/join",
        name: "Team room",
      };

      const renamed = { ...entry, name: "Renamed room" };

      const saved = (entries: readonly (typeof entry)[], requestId: number) =>
        Message.ChangedConferencingSettings({
          change: Change.cases.Saved.make({ entries, requestId }),
          personId,
        });

      Scene.scene(
        { update, view },
        Scene.given(model),
        Scene.Mount.resolve(PrepareKeyboard, Message.KeyboardClose()),
        Scene.Mount.resolve(
          PrepareEditingDialogs,
          Message.EditingAction({ action: EditorAction.cases.Cancel.make({}) })
        ),
        Scene.Command.resolve(DispatchEditing, Message.DispatchedEditing()),
        Scene.expect(
          Scene.role("heading", { name: /^Conferencing$/u })
        ).toExist(),
        Scene.click(Scene.role("button", { name: "Add custom video link" })),
        Scene.type(Scene.selector("#custom-video-name"), "Team room"),
        Scene.type(Scene.selector("#custom-video-link"), "room.example/join"),
        Scene.submit(Scene.selector(".settings-conferencing-form")),
        Scene.expect(Scene.role("button", { name: "Saving…" })).toBeDisabled(),
        Scene.Command.resolve(SaveCustomVideoLinks, saved([entry], 1)),
        Scene.expect(Scene.selector("#custom-video-room-one a")).toHaveAttr(
          "href",
          entry.link
        ),
        Scene.click(Scene.role("button", { name: "Edit Team room" })),
        Scene.type(Scene.selector("#custom-video-name"), "Discarded draft"),
        Scene.click(Scene.role("button", { name: "Cancel" })),
        Scene.expect(Scene.selector("#custom-video-room-one")).toContainText(
          "Team room"
        ),
        Scene.click(Scene.role("button", { name: "Edit Team room" })),
        Scene.type(Scene.selector("#custom-video-name"), "Renamed room"),
        Scene.submit(Scene.selector(".settings-conferencing-form")),
        Scene.Command.resolve(SaveCustomVideoLinks, saved([renamed], 2)),
        Scene.click(Scene.role("button", { name: "Remove Renamed room" })),
        Scene.expect(Scene.selector("#custom-video-room-one")).toExist(),
        Scene.Command.resolve(
          SaveCustomVideoLinks,
          Message.ChangedConferencingSettings({
            change: Change.cases.Failed.make({
              message: "Removal could not be saved",
              requestId: 3,
            }),
            personId,
          })
        ),
        Scene.expect(Scene.selector("#custom-video-room-one")).toExist(),
        Scene.expect(Scene.role("alert")).toContainText(
          "Removal could not be saved"
        ),
        Scene.click(Scene.role("button", { name: "Remove Renamed room" })),
        Scene.Command.resolve(SaveCustomVideoLinks, saved([], 4)),
        Scene.expect(Scene.selector("#custom-video-room-one")).toBeAbsent(),
        Scene.expect(
          Scene.role("button", { name: "Add custom video link" })
        ).toBeEnabled(),
        Scene.expect(Scene.selector(".workspace")).toBeAbsent()
      );
    })
);

it.effect(
  "invalid and failed saves keep the actual edit form and submitted text",
  () =>
    Effect.sync(() => {
      const model = fixture();
      const personId = Option.getOrThrow(model.person);
      Scene.scene(
        { update, view },
        Scene.given(model),
        Scene.Mount.resolve(PrepareKeyboard, Message.KeyboardClose()),
        Scene.Mount.resolve(
          PrepareEditingDialogs,
          Message.EditingAction({ action: EditorAction.cases.Cancel.make({}) })
        ),
        Scene.Command.resolve(DispatchEditing, Message.DispatchedEditing()),
        Scene.click(Scene.role("button", { name: "Add custom video link" })),
        Scene.submit(Scene.selector(".settings-conferencing-form")),
        Scene.expect(Scene.selector("#custom-video-name-error")).toContainText(
          "Name is required"
        ),
        Scene.expect(Scene.selector("#custom-video-link-error")).toContainText(
          "Conferencing link is required"
        ),
        Scene.type(Scene.selector("#custom-video-name"), "My room"),
        Scene.type(
          Scene.selector("#custom-video-link"),
          `${rejectedLinkScheme}:alert(1)`
        ),
        Scene.submit(Scene.selector(".settings-conferencing-form")),
        Scene.expect(Scene.selector("#custom-video-link-error")).toContainText(
          "Must be a valid URL"
        ),
        Scene.type(
          Scene.selector("#custom-video-link"),
          "my-room.example/join"
        ),
        Scene.submit(Scene.selector(".settings-conferencing-form")),
        Scene.Command.resolve(
          SaveCustomVideoLinks,
          Message.ChangedConferencingSettings({
            change: Change.cases.Failed.make({
              message: "Storage unavailable",
              requestId: 1,
            }),
            personId,
          })
        ),
        Scene.expect(Scene.role("alert")).toContainText("Storage unavailable"),
        Scene.expect(Scene.selector("#custom-video-name")).toHaveValue(
          "My room"
        ),
        Scene.expect(Scene.selector("#custom-video-link")).toHaveValue(
          "my-room.example/join"
        ),
        Scene.expect(Scene.role("button", { name: "Save" })).toBeEnabled(),
        Scene.click(Scene.role("button", { name: "Cancel" })),
        Scene.expect(Scene.selector(".settings-conferencing-form")).toBeAbsent()
      );
    })
);

it.effect(
  "the page exposes its literal nav route and account-default recipients without provider auth controls",
  () =>
    Effect.sync(() => {
      const model = fixture();
      Scene.scene(
        { update, view },
        Scene.given(model),
        Scene.Mount.resolve(PrepareKeyboard, Message.KeyboardClose()),
        Scene.Mount.resolve(
          PrepareEditingDialogs,
          Message.EditingAction({ action: EditorAction.cases.Cancel.make({}) })
        ),
        Scene.Command.resolve(DispatchEditing, Message.DispatchedEditing()),
        Scene.expect(
          Scene.selector('.settings-nav a[href="/settings/conferencing"]')
        ).toHaveAttr("aria-current", "page"),
        Scene.expect(
          Scene.selector('.settings-content a[href="/settings/calendar/work"]')
        ).toExist(),
        Scene.expect(Scene.selector(".settings-content")).toContainText(
          "do not sync across devices"
        ),
        Scene.expect(Scene.role("button", { name: /Zoom/u })).toBeAbsent()
      );
    })
);

import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Scene } from "foldkit/test";

import { Message, update } from "../src/client/app.js";
import { DispatchEditing } from "../src/client/editing/commands.js";
import { PrepareEditingDialogs } from "../src/client/editing/dialog-mount.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { PrepareGestures } from "../src/client/editing/gesture-mount.js";
import { PrepareTimeGrid } from "../src/client/grid-mount.js";
import { PrepareKeyboard } from "../src/client/keyboard/mount.js";
import { PrepareSelection } from "../src/client/selection/mount.js";
import { PrepareZoneDrag } from "../src/client/zone-drag/mount.js";
import { view } from "../src/features/app.js";
import { fixtureModel } from "./fixture.js";

it.effect(
  "clicking a rendered event opens and closes its read-only detail panel",
  () =>
    Effect.sync(() => {
      Scene.scene(
        { update, view },
        Scene.given(fixtureModel()),
        Scene.Mount.resolve(PrepareKeyboard, Message.KeyboardClose()),
        Scene.Mount.resolve(PrepareSelection, Message.PreparedSelection()),
        Scene.Mount.resolve(
          PrepareZoneDrag,
          Message.PreparedZoneDragHost({ hostKey: "" })
        ),
        Scene.Mount.resolve(
          PrepareTimeGrid,
          Message.MeasuredViewport({ gutter: 0, height: 844, width: 1220 })
        ),
        Scene.Mount.resolve(
          PrepareEditingDialogs,
          Message.EditingAction({ action: EditorAction.cases.Cancel.make({}) })
        ),
        Scene.Command.resolve(DispatchEditing, Message.DispatchedEditing()),
        Scene.Mount.resolve(
          PrepareGestures,
          Message.PreviewedGesture({
            personId: "fixture-person",
            preview: Option.none(),
          })
        ),
        Scene.expect(Scene.selector(".detail-panel")).toBeAbsent(),
        Scene.click(Scene.role("button", { name: /^Product review/u })),
        Scene.expect(Scene.selector(".detail-panel")).toContainText(
          "Product review"
        ),
        Scene.expect(
          Scene.role("button", { name: "Join meeting ↗" })
        ).toExist(),
        Scene.click(Scene.role("button", { name: "Close event details" })),
        Scene.expect(Scene.selector(".detail-panel")).toBeAbsent()
      );
    })
);

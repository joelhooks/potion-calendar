import { it } from "@effect/vitest";
import { Effect } from "effect";
import { Scene } from "foldkit/test";

import { Message, update } from "../src/client/app.js";
import { PrepareTimeGrid } from "../src/client/grid-mount.js";
import { view } from "../src/features/app.js";
import { fixtureModel } from "./fixture.js";

it.effect(
  "clicking a rendered event opens and closes its read-only detail panel",
  () =>
    Effect.sync(() => {
      Scene.scene(
        { update, view },
        Scene.given(fixtureModel()),
        Scene.Mount.resolve(
          PrepareTimeGrid,
          Message.MeasuredViewport({ gutter: 0, height: 844, width: 1220 })
        ),
        Scene.expect(Scene.selector(".detail-panel")).toBeAbsent(),
        Scene.click(Scene.role("button", { name: /^Product review/u })),
        Scene.expect(Scene.selector(".detail-panel")).toContainText(
          "Product review"
        ),
        Scene.expect(Scene.selector(".join-link")).toHaveAttr(
          "href",
          "https://meet.google.com/abc-defg-hij"
        ),
        Scene.click(Scene.role("button", { name: "Close event details" })),
        Scene.expect(Scene.selector(".detail-panel")).toBeAbsent()
      );
    })
);

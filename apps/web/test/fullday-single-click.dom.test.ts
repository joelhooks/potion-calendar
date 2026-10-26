import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option, Predicate } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { fulldayModel, mountedFullday } from "./fullday-fixture.js";

for (const platform of ["MacIntel", "Win32"]) {
  it.effect(
    `one empty Mod-click preserves selection, highlight and flash on ${platform}`,
    () =>
      Effect.gen(function* singleClickBaseline() {
        const base = fulldayModel("timed");

        const model = {
          ...base,
          keyboard: {
            ...base.keyboard,
            cursor: Option.fromUndefinedOr(base.calendar.selected[0]),
            flash: Option.some(base.calendar.navigation.anchor),
            flashVersion: 7,
            highlighted: "existing-highlight",
          },
        };

        const h = yield* mountedFullday(model, platform);
        const before = h.get();

        const expected = {
          cursor: before.keyboard.cursor,
          flash: before.keyboard.flash,
          flashVersion: before.keyboard.flashVersion,
          highlighted: before.keyboard.highlighted,
          selected: before.calendar.selected,
        };

        expect(expected.selected).toHaveLength(1);
        const cell = yield* Effect.fromNullishOr(h.cells.at(-1));
        yield* h.click(cell, 100, 547, { mod: true });
        const after = h.get();
        expect(h.commands).toEqual([]);
        expect(
          h.messages.filter((message) =>
            Predicate.isTagged(message, "CompletedGesture")
          )
        ).toEqual([]);
        expect({
          cursor: after.keyboard.cursor,
          flash: after.keyboard.flash,
          flashVersion: after.keyboard.flashVersion,
          highlighted: after.keyboard.highlighted,
          selected: after.calendar.selected,
        }).toEqual(expected);

        const previous = yield* renderToString(
          { init: () => ({ model: before }), view },
          { isHydratable: false }
        );

        const next = yield* renderToString(
          { init: () => ({ model: after }), view },
          { isHydratable: false }
        );

        expect(next.html).toBe(previous.html);
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory("../../.rat/fullday/single-click", {
          recursive: true,
        });
        yield* fs.writeFileString(
          `../../.rat/fullday/single-click/${platform}.html`,
          next.html
        );
        yield* fs.writeFileString(
          `../../.rat/fullday/single-click/${platform}.json`,
          JSON.stringify(expected)
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
}

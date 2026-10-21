import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Ref } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message } from "../src/client/app.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { view } from "../src/features/app.js";
import { heldModRuntimeFixture } from "./held-mod-runtime-fixture.js";

it.effect.each(["week-move", "repeat-resize", "month-move"] as const)(
  "%s renders the exact no-email move receipt in the existing stack and dismisses only its current id",
  (scenario) =>
    Effect.gen(function* movedNoticeRecipient() {
      const h = yield* heldModRuntimeFixture({ scenario });

      const rendered = yield* renderToString(
        { init: () => ({ model: h.model }), view },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      const notice = document.querySelector(
        ".notification-stack .instant-save-notice"
      );

      const expected =
        scenario === "repeat-resize"
          ? 'Moved this occurrence of "Design review". No email sent.'
          : 'Moved "Weekly sync". No email sent.';

      expect(notice?.querySelector("p")?.textContent).toBe(expected);
      expect(
        notice?.querySelector('button[aria-label="Dismiss moved notice"]')
      ).not.toBeNull();
      expect(notice?.textContent).not.toContain("Undo");
      expect(h.model.editing.deletes).toEqual(h.before.editing.deletes);

      const receipt = Option.getOrThrow(h.model.editing.instantSaved);

      yield* h.dispatch(
        Message.EditingAction({
          action: EditorAction.cases.DismissInstantSave.make({
            id: "not-current-id",
          }),
        })
      );
      expect((yield* Ref.get(h.state)).editing.instantSaved).toEqual(
        Option.some(receipt)
      );
      yield* h.dispatch(
        Message.EditingAction({
          action: EditorAction.cases.DismissInstantSave.make({
            id: receipt.id,
          }),
        })
      );
      expect((yield* Ref.get(h.state)).editing.instantSaved).toEqual(
        Option.none()
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

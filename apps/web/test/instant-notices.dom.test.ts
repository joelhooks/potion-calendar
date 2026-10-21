import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { EditorAction } from "../src/client/editing/editor-action.js";
import { EditorMutation } from "../src/client/editing/editor-session-model.js";
import { editAction, mutationReceived } from "../src/client/editing/update.js";
import { view } from "../src/features/app.js";
import { instantArtifactFixture } from "./instant-artifact-fixture.js";

const noticeScenes = [
  {
    expected: 'Removed "Weekly sync" from your calendar. No email sent.',
    scenario: "meeting-delete",
  },
  {
    expected: 'Cancelled this occurrence of "Design review". No email sent.',
    scenario: "repeat-delete",
  },
  { expected: undefined, scenario: "readonly-delete" },
  { expected: 'Saved "Weekly sync". No email sent.', scenario: "editor-save" },
] as const;

it.effect.each(noticeScenes)(
  "$scenario uses the source role and occurrence receipt in its exact no-email result",
  ({ scenario, expected }) =>
    Effect.gen(function* instantNoticeCopy() {
      const fixture = yield* instantArtifactFixture(scenario);

      const rendered = yield* renderToString(
        { init: () => ({ model: fixture.model }), view },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      const notice = document.querySelector(
        scenario === "editor-save"
          ? ".instant-save-notice p"
          : ".undo-toast > span"
      );

      expect(notice?.textContent).toBe(expected);
      expect(fixture.evidence.mutations).toHaveLength(
        scenario === "editor-save" ? 1 : 0
      );
      expect(document.querySelector(".app")?.textContent).not.toContain(
        "Loading events…"
      );
      expect(fixture.evidence.source?.title).toBe(
        scenario === "repeat-delete" || scenario === "readonly-delete"
          ? "Design review"
          : "Weekly sync"
      );
      expect(fixture.evidence.calendar?.title).toBe("Work");

      if (scenario === "editor-save") {
        expect(document.querySelector(".detail-time")?.textContent).toContain(
          "11am – 12pm"
        );
        expect(document.querySelector(".detail-panel")?.textContent).toContain(
          "· Organizer"
        );
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

it.effect(
  "save receipt dismissal is id-scoped and a later ordinary save clears old no-email copy",
  () =>
    Effect.gen(function* saveReceiptHistory() {
      const fixture = yield* instantArtifactFixture("editor-save");
      const before = fixture.model;
      const notice = Option.getOrThrow(before.editing.instantSaved);

      const staleDismiss = editAction(
        before,
        EditorAction.cases.DismissInstantSave.make({ id: "previous-save" })
      );

      expect(staleDismiss.model.editing.instantSaved).toEqual(
        before.editing.instantSaved
      );

      const dismissed = editAction(
        before,
        EditorAction.cases.DismissInstantSave.make({ id: notice.id })
      );

      expect(dismissed.model.editing.instantSaved).toEqual(Option.none());

      const plan = Option.getOrThrow(fixture.prepared);
      const id = "ordinary-save-after-instant";

      const mutation = EditorMutation.cases.Saved.make({
        event: Option.getOrThrow(
          Option.fromUndefinedOr(fixture.evidence.source)
        ),
        id,
        plan: {
          ...plan,
          sendUpdates: "all",
          session: { ...plan.session, id, intent: "ordinary" },
        },
      });

      const after = mutationReceived(before, mutation).model;
      expect(after.editing.handledMutation).toEqual(Option.some(id));
      expect(after.editing.instantSaved).toEqual(Option.none());
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

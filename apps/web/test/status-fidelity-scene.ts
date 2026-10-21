import { Effect, Option, Ref } from "effect";

import { EditorAction } from "../src/client/editing/editor-action.js";
import { EditorMutation } from "../src/client/editing/editor-session-model.js";
import { selectedEvent } from "../src/client/keyboard/registry.js";
import {
  createTypeRuntimeFixture,
  nextTypeNotice,
} from "./create-type-runtime-fixture.js";
import { savedStatusFixture } from "./status-fidelity-fixture.js";
import type { StatusFidelityScene } from "./status-fidelity-fixture.js";

export const statusFidelityScene = Effect.fn("statusFidelityScene")(
  function* statusFidelityScene(scene: StatusFidelityScene) {
    if (scene === "focus-create") {
      const f = yield* createTypeRuntimeFixture("focus");
      const model = yield* Ref.get(f.state);
      yield* f.dispatch(EditorAction.cases.Save.make({}));

      const settled = yield* nextTypeNotice(f.queue, (notice) =>
        Option.isSome(notice.mutation)
      );

      const mutation = Option.getOrThrow(settled.mutation);

      if (!EditorMutation.guards.Saved(mutation)) {
        return yield* Effect.die("Missing accepted Focus insert");
      }

      return {
        evidence: {
          calendar: f.calendar,
          expectedTitle: "Writing time",
          receipts: yield* Ref.get(f.api.fake.receipts),
          renderedStage: "before-create-save",
          scene,
          source: mutation.event,
          sourceNature: "Accepted actual fake-Google insert response",
        },
        model,
      };
    }

    const type = scene.startsWith("ooo") ? "outOfOffice" : "focusTime";

    const defaults = {
      focusTime: "declineNone",
      outOfOffice: "declineOnlyNewConflictingInvitations",
    } as const;

    const mode =
      scene === "focus-editor"
        ? "declineAllConflictingInvitations"
        : defaults[type];

    const f = yield* savedStatusFixture({ mode, type });
    let model = yield* Ref.get(f.state);

    if (scene.endsWith("editor")) {
      yield* f.open();
      model = yield* Ref.get(f.state);
    }

    if (scene === "focus-editor") {
      model = (yield* f.titleEdit()).beforeSave;
    }

    const selected = selectedEvent(model);

    if (
      selected?.source.eventId !== f.source.eventId ||
      selected.source.eventType !== type
    ) {
      return yield* Effect.die("Missing loaded selected status source");
    }

    return {
      evidence: {
        calendar: f.calendar,
        expectedTitle:
          scene === "focus-editor"
            ? "Drafting the plan"
            : (f.source.title ?? ""),
        receipts: yield* Ref.get(f.api.fake.receipts),
        renderedStage:
          scene === "focus-editor"
            ? "before-title-save-with-accepted-patch-receipt"
            : "saved-source",
        scene,
        source: f.source,
        sourceNature:
          "Actual fake-Google read with adversarial ordinary metadata; not a claim that Google emits those fields on a status event",
      },
      model,
    };
  }
);

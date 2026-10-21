import { expect, it } from "@effect/vitest";
import { Effect, Option, Ref } from "effect";

import { response } from "../../../packages/calendar/test/fake-google.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import {
  createTypeRuntimeFixture,
  nextTypeNotice,
  renderTypeRoot,
} from "./create-type-runtime-fixture.js";

it.effect.each(["focus", "ooo"] as const)(
  "a confirmed 400 refusal names the chosen %s type and preserves it without fallback",
  (scene) =>
    Effect.gen(function* typeRefusal() {
      const f = yield* createTypeRuntimeFixture(scene);
      yield* Ref.set(f.api.fake.pending, [
        f.calendarReply,
        response(400, {
          error: {
            errors: [{ reason: "invalid" }],
            message: "Unsupported account",
          },
        }),
      ]);
      yield* f.dispatch(EditorAction.cases.Save.make({}));

      const failure = yield* nextTypeNotice(f.queue, (notice) =>
        EditorView.guards.Failure(notice.view)
      );

      expect(Option.isNone(failure.mutation)).toBe(true);
      const rendered = yield* renderTypeRoot(yield* Ref.get(f.state));
      const doc = new DOMParser().parseFromString(rendered.html, "text/html");
      expect(doc.body.textContent).toContain(
        `Google didn't accept a ${scene === "focus" ? "Focus time" : "Out of office"} event for this account. Nothing was created.`
      );
      expect(doc.querySelector<HTMLSelectElement>("#event-type")?.value).toBe(
        scene === "focus" ? "focusTime" : "outOfOffice"
      );
      expect(
        (yield* Ref.get(f.api.fake.receipts)).filter(
          (receipt) => receipt.request.method === "POST"
        )
      ).toHaveLength(1);
    })
);

it.effect(
  "all-day creation leaves Event usable and disables only unsupported status choices with the documented reason",
  () =>
    Effect.gen(function* allDayTypes() {
      const f = yield* createTypeRuntimeFixture("event");
      yield* f.dispatch(EditorAction.cases.ToggleAllDay.make({}));
      yield* nextTypeNotice(
        f.queue,
        (notice) =>
          EditorView.guards.Editing(notice.view) && notice.view.draft.allDay
      );
      const rendered = yield* renderTypeRoot(yield* Ref.get(f.state));
      const doc = new DOMParser().parseFromString(rendered.html, "text/html");
      expect(
        doc.querySelector<HTMLSelectElement>("#event-type")?.disabled
      ).toBe(false);
      expect(
        doc.querySelector<HTMLOptionElement>(
          '#event-type option[value="default"]'
        )?.disabled
      ).toBe(false);
      expect(
        doc.querySelector<HTMLOptionElement>(
          '#event-type option[value="focusTime"]'
        )?.disabled
      ).toBe(true);
      expect(
        doc.querySelector<HTMLOptionElement>(
          '#event-type option[value="outOfOffice"]'
        )?.disabled
      ).toBe(true);
      expect(doc.querySelector("#event-type-reason")?.textContent).toBe(
        "Focus time and Out of office can't be all day."
      );
      expect(yield* Ref.get(f.api.fake.receipts)).toHaveLength(0);
    })
);

it.effect(
  "a malformed successful response must not become a definite zero-creation refusal",
  () =>
    Effect.gen(function* malformedResult() {
      const f = yield* createTypeRuntimeFixture("refused", 200);
      yield* f.dispatch(EditorAction.cases.Save.make({}));
      yield* nextTypeNotice(f.queue, (notice) =>
        EditorView.guards.Failure(notice.view)
      );
      const rendered = yield* renderTypeRoot(yield* Ref.get(f.state));
      expect(rendered.html).toContain("result could not be confirmed");
      expect(rendered.html).not.toContain("Nothing was created.");
      expect(rendered.html).not.toContain("event-save-as-event");
      expect(
        (yield* Ref.get(f.api.fake.receipts)).filter(
          (receipt) => receipt.request.method === "POST"
        )
      ).toHaveLength(1);
    })
);

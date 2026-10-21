import { expect, it } from "@effect/vitest";
import { Effect, Option, Ref } from "effect";

import { EditorAction } from "../src/client/editing/editor-action.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import {
  createTypeRuntimeFixture,
  nextTypeNotice,
  renderTypeRoot,
} from "./create-type-runtime-fixture.js";
import { writeBody } from "./editing-rpc-fixture.js";

it.effect.each(["focus", "ooo"] as const)(
  "the %s automatic-decline control starts unticked and only an explicit opt-in requests new-only declines",
  (scene) =>
    Effect.gen(function* explicitStatusOptIn() {
      const f = yield* createTypeRuntimeFixture(scene);
      const before = yield* renderTypeRoot(yield* Ref.get(f.state));

      const beforeDom = new DOMParser().parseFromString(
        before.html,
        "text/html"
      );

      expect(
        beforeDom.querySelector<HTMLInputElement>("#event-status-invitations")
          ?.checked
      ).toBe(false);
      expect(beforeDom.body.textContent).toContain(
        "Decline new invitations during this time"
      );
      yield* f.dispatch(
        EditorAction.cases.StatusInvitationsChosen.make({ value: true })
      );
      yield* nextTypeNotice(
        f.queue,
        (notice) =>
          EditorView.guards.Editing(notice.view) &&
          notice.view.draft.statusInvitationChoice ===
            "declineOnlyNewConflictingInvitations"
      );
      const chosen = yield* renderTypeRoot(yield* Ref.get(f.state));
      expect(
        new DOMParser()
          .parseFromString(chosen.html, "text/html")
          .querySelector<HTMLInputElement>("#event-status-invitations")?.checked
      ).toBe(true);
      yield* f.dispatch(EditorAction.cases.Save.make({}));
      yield* nextTypeNotice(f.queue, (notice) =>
        Option.isSome(notice.mutation)
      );

      const posts = (yield* Ref.get(f.api.fake.receipts)).filter(
        (receipt) => receipt.request.method === "POST"
      );

      expect(posts).toHaveLength(1);
      const body = writeBody(posts[0]?.request.body);
      expect(
        body[
          scene === "focus" ? "focusTimeProperties" : "outOfOfficeProperties"
        ]
      ).toEqual({ autoDeclineMode: "declineOnlyNewConflictingInvitations" });
      expect(posts[0]?.request.path).toContain("sendUpdates=none");
      expect(body.attendees).toEqual([]);
    })
);

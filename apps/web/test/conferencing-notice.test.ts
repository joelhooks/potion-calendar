import { ConferencingStatus } from "@calendar/calendar/conferencing";
import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { savedConferencingNotice } from "../src/client/editing/conferencing-notice.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import {
  EditorMutation,
  LoadedEditor,
} from "../src/client/editing/editor-session-model.js";
import { prepareEditor } from "../src/client/editing/prepare-editor.js";
import { editAction } from "../src/client/editing/update.js";
import { dayFromIso, initialNavigation } from "../src/layout/navigation.js";
import {
  editorCalendars,
  editorDraft,
  editorOriginal,
} from "./editor-fixture.js";
import { fixtureModel } from "./fixture.js";

const planForNotice = Effect.fn("planForConferencingNotice")(
  function* planForNotice() {
    return yield* prepareEditor(
      LoadedEditor.make({
        baseline: editorDraft,
        calendars: editorCalendars,
        createId: Option.none(),
        draft: {
          ...editorDraft,
          conferencing: {
            participantSeen: true,
            request: { kind: "googleMeet" },
          },
        },
        id: "notice-write",
        kind: "edit",
        master: Option.none(),
        moveSupport: "available",
        navigation: initialNavigation(dayFromIso("2026-10-19")),
        operation: "save",
        original: Option.some(editorOriginal),
        selection: Option.none(),
      })
    );
  }
);

it.effect.prop(
  "a committed Meet result preserves pending, failed and unconfirmed status without implying another event should be created",
  { status: ConferencingStatus },
  ({ status }) =>
    Effect.gen(function* savedResult() {
      const plan = yield* planForNotice();

      const notice = savedConferencingNotice(
        EditorMutation.cases.Saved.make({
          event: { ...editorOriginal, conferencingStatus: status },
          id: "notice-write",
          plan,
        })
      );

      expect(Option.getOrThrow(notice)).toMatchObject({
        eventId: editorOriginal.eventId,
        id: "notice-write",
        status,
      });

      const ordinary = {
        ...plan,
        session: { ...plan.session, draft: editorDraft },
      };

      expect(
        savedConferencingNotice(
          EditorMutation.cases.Saved.make({
            event: { ...editorOriginal, conferencingStatus: status },
            id: "ordinary-write",
            plan: ordinary,
          })
        )
      ).toEqual(Option.none());
    })
);

it.effect(
  "removal is confirmed only by absent native and recognized conferencing; stale dismiss cannot clear a newer saved result",
  () =>
    Effect.gen(function* removedResult() {
      const originalPlan = yield* planForNotice();

      const plan = {
        ...originalPlan,
        session: {
          ...originalPlan.session,
          draft: {
            ...editorDraft,
            conferencing: { participantSeen: true, request: { kind: "none" } },
          },
        },
      } as const;

      const removed = savedConferencingNotice(
        EditorMutation.cases.Saved.make({
          event: editorOriginal,
          id: "latest-write",
          plan,
        })
      );

      expect(Option.getOrThrow(removed).status).toBe("removed");

      for (const event of [
        { ...editorOriginal, conferencingStatus: "unconfirmed" },
        { ...editorOriginal, location: "https://zoom.us/j/123" },
      ] as const) {
        const unknown = savedConferencingNotice(
          EditorMutation.cases.Saved.make({ event, id: "unknown-write", plan })
        );

        expect(Option.getOrThrow(unknown).status).toBe("unconfirmed");
      }

      const fixture = fixtureModel();

      const model = {
        ...fixture,
        editing: { ...fixture.editing, conferencingResult: removed },
      };

      const stale = editAction(
        model,
        EditorAction.cases.DismissConferencingNotice.make({ id: "old-write" })
      );

      expect(stale.model.editing.conferencingResult).toEqual(removed);
      expect(stale.commands).toBeUndefined();

      const dismissed = editAction(
        model,
        EditorAction.cases.DismissConferencingNotice.make({
          id: "latest-write",
        })
      );

      expect(dismissed.model.editing.conferencingResult).toEqual(Option.none());
      expect(dismissed.commands).toBeUndefined();
    })
);

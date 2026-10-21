import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Ref, Schema } from "effect";

import { Message } from "../src/client/app.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { GestureTarget } from "../src/client/editing/gesture-model.js";
import { EditingNotice } from "../src/client/editing/runtime.js";
import { gestureRange } from "../src/layout/gesture-range.js";
import { dayFromIso } from "../src/layout/navigation.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { writeBody } from "./editing-rpc-fixture.js";
import { editorOriginal } from "./editor-fixture.js";
import {
  heldModRuntimeFixture,
  heldModScenarios,
} from "./held-mod-runtime-fixture.js";
import { nextInstantNotice } from "./instant-runtime-fixture.js";

it.effect.each(heldModScenarios)(
  "native held modifier %s uses the existing root and single no-email writer without touching another selection",
  (scenario) =>
    Effect.gen(function* heldModifierRecipient() {
      const h = yield* heldModRuntimeFixture({ scenario });
      const requests = yield* Ref.get(h.api.fake.requests);
      const writes = requests.filter((request) => request.method !== "GET");
      expect(h.native.selectionChanges).toBe(0);
      expect(h.model.calendar.selected).toEqual(h.before.calendar.selected);

      if (scenario === "readonly") {
        expect(h.native.refusal).toBe("ReadOnlyEvent");
        expect(h.native.completed).toBeUndefined();
        expect(h.model.editing.gestureRefusal).toEqual(
          Option.some("ReadOnlyEvent")
        );
        expect(requests).toHaveLength(0);
        expect(h.model.editing.instantSaved).toEqual(Option.none());

        return;
      }

      expect(h.native.completed?.intent).toBe("noEmailGesture");
      expect(h.saved?.plan.scope).toBe("single");
      expect(h.saved?.plan.sendUpdates).toBe("none");
      expect(h.saved?.plan.prompt).toBe("none");
      expect(h.saved?.plan.emailNeeded).toBe(false);
      expect(writes).toHaveLength(1);
      expect(writes[0]?.method).toBe("PATCH");
      expect(
        new URL(writes[0]?.path ?? "", "https://fixture.invalid").pathname
      ).toBe("/calendars/calendar/events/instant-instance");
      expect(
        new URL(
          writes[0]?.path ?? "",
          "https://fixture.invalid"
        ).searchParams.get("sendUpdates")
      ).toBe("none");

      const expected = {
        "month-move": {
          end: "2026-10-22T17:00:00.000Z",
          start: "2026-10-22T16:00:00.000Z",
        },
        "repeat-resize": {
          end: "2026-10-21T18:00:00.000Z",
          start: "2026-10-21T16:00:00.000Z",
        },
        "week-move": {
          end: "2026-10-21T19:00:00.000Z",
          start: "2026-10-21T18:00:00.000Z",
        },
      }[scenario];

      const written = yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          end: Schema.Struct({ dateTime: Schema.String }),
          start: Schema.optionalKey(Schema.Struct({ dateTime: Schema.String })),
        })
      )(writeBody(writes[0]?.body));

      const originalStart = h.source.start;

      if (originalStart === undefined || !("dateTime" in originalStart)) {
        throw new Error("Missing original timed start");
      }

      expect(
        Date.parse(written.start?.dateTime ?? originalStart.dateTime)
      ).toBe(Date.parse(expected.start));
      expect(Date.parse(written.end.dateTime)).toBe(Date.parse(expected.end));
      expect(h.views).not.toContain("Scope");
      expect(h.views).not.toContain("Email");
      expect(Option.getOrThrow(h.model.editing.instantSaved).movement).toBe(
        scenario === "repeat-resize" ? "occurrence" : "event"
      );

      for (const peer of visibleEvents(h.before).filter(
        (item) => item.source.eventId !== h.source.eventId
      )) {
        expect(
          visibleEvents(h.model).find((item) => item.key === peer.key)?.source
        ).toEqual(peer.source);
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

it.effect.each(["MacIntel", "Win32"] as const)(
  "native %s samples Mod at drop: adding it skips dialogs and releasing it retains ordinary meeting dialogs",
  (platform) =>
    Effect.gen(function* dropTimeModifier() {
      const added = yield* heldModRuntimeFixture({
        downMod: false,
        dropMod: true,
        platform,
        scenario: "week-move",
      }).pipe(Effect.scoped);

      expect(added.saved?.plan.session.intent).toBe("noEmailGesture");
      expect(added.views).not.toContain("Email");

      const shifted = yield* heldModRuntimeFixture({
        downMod: false,
        dropMod: true,
        dropShift: true,
        platform,
        scenario: "repeat-resize",
        shift: false,
      }).pipe(Effect.scoped);

      expect(shifted.saved?.plan.scope).toBe("single");
      expect(shifted.native.pointerLog.at(-1)?.shiftKey).toBe(true);

      const released = yield* heldModRuntimeFixture({
        downMod: true,
        dropMod: false,
        platform,
        scenario: "week-move",
      }).pipe(Effect.scoped);

      expect(released.model.editing.view._tag).toBe("Email");
      expect(released.native.completed?.intent ?? "ordinary").toBe("ordinary");
      expect(
        (yield* Ref.get(released.api.fake.requests)).every(
          (request) => request.method === "GET"
        )
      ).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

it.effect(
  "releasing Mod before a recurring resize retains both ordinary scope and email dialogs",
  () =>
    Effect.gen(function* ordinaryRepeatResize() {
      const h = yield* heldModRuntimeFixture({
        downMod: true,
        dropMod: false,
        scenario: "repeat-resize",
      });

      expect(h.model.editing.view._tag).toBe("Scope");
      yield* h.dispatch(
        Message.EditingAction({
          action: EditorAction.cases.ScopeSelected.make({ value: "single" }),
        })
      );
      yield* nextInstantNotice(
        h.queue,
        (notice) =>
          EditingNotice.guards.Editor(notice) &&
          EditorView.guards.Scope(notice.view)
      );
      yield* h.dispatch(
        Message.EditingAction({
          action: EditorAction.cases.ConfirmScope.make({}),
        })
      );
      yield* nextInstantNotice(
        h.queue,
        (notice) =>
          EditingNotice.guards.Editor(notice) &&
          EditorView.guards.Email(notice.view)
      );
      expect((yield* Ref.get(h.state)).editing.view._tag).toBe("Email");
      expect(
        (yield* Ref.get(h.api.fake.requests)).every(
          (request) => request.method === "GET"
        )
      ).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

it.effect.prop(
  "drop-time intent ignores start-time modifiers and never turns creation or Alt-copy into an instant original write",
  {
    alt: Schema.Boolean,
    downMod: Schema.Boolean,
    dropMod: Schema.Boolean,
    edge: Schema.Literals(["body", "start", "end"]),
    existing: Schema.Boolean,
    shift: Schema.Boolean,
  },
  ({ downMod, dropMod, shift, alt, existing, edge }) =>
    Effect.sync(() => {
      const day = dayFromIso("2026-10-21");

      const point = {
        alt: false,
        at: 0,
        day,
        minute: 540,
        mod: downMod,
        pointerId: 1,
        shift: false,
        x: 0,
        y: 0,
      };

      const target = GestureTarget.make({
        allDay: false,
        editable: true,
        end: day * 1440 + 600,
        event: editorOriginal,
        key: "test",
        start: day * 1440 + 540,
      });

      const result = gestureRange(
        {
          allDay: false,
          edge: existing ? edge : "body",
          point,
          target: existing ? Option.some(target) : Option.none(),
        },
        { ...point, alt, minute: 660, mod: dropMod, shift, y: 120 },
        1
      );

      expect(result.intent ?? "ordinary").toBe(
        dropMod && existing && !(alt && edge === "body")
          ? "noEmailGesture"
          : "ordinary"
      );
      expect(result.duplicate).toBe(alt && existing && edge === "body");
    })
);

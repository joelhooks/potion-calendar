import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { PreparedRsvpNote } from "../src/client/editing/rsvp-machine.js";
import { EditingNotice } from "../src/client/editing/runtime.js";
import { Message } from "../src/client/message.js";
import { noteFocusFixture } from "./tray-note-focus-fixture.js";
import { recoveryEnd } from "./tray-note-recovery-fixture.js";
import { upcomingPerson } from "./upcoming-fixture.js";

it.effect.each([1280, 390])(
  "root busy cycles restore owned focus once with caret at end at %i",
  (width) =>
    Effect.gen(function* cycles() {
      const f = yield* noteFocusFixture(width);
      const { prepared } = f.h.model().editing.rsvp;

      for (const cycle of [1, 2]) {
        yield* f.apply(f.busyMessage(true));
        expect(f.field.disabled).toBe(true);
        expect(document.activeElement).not.toBe(f.field);
        const pending = yield* f.begin(f.busyMessage(false));
        expect(
          pending.signal.kind,
          "owned busy-to-idle must schedule one restore"
        ).toBe("frame");
        yield* f.finish(pending);
        expect(document.activeElement).toBe(f.field);
        expect(f.field.selectionStart).toBe(f.field.value.length);
        expect(f.field.selectionEnd).toBe(f.field.value.length);
        expect(f.restores).toHaveBeenCalledTimes(cycle);
        yield* f.apply(Message.CompletedRsvpNoteFocus());
        expect(f.restores).toHaveBeenCalledTimes(cycle);
        expect(f.h.model().editing.rsvp.prepared).toEqual(prepared);
        expect(f.h.calls).toHaveLength(0);
      }
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
);

it.effect.each(
  [1280, 390].flatMap((width) =>
    ["before scheduling", "between scheduling and commit"].flatMap((phase) =>
      [false, true].map((backToBody) => ({ backToBody, phase, width }))
    )
  )
)("root no-steal history %j", ({ width, phase, backToBody }) =>
  Effect.gen(function* noSteal() {
    const f = yield* noteFocusFixture(width);
    yield* f.apply(f.busyMessage(true));

    if (phase === "before scheduling") {
      f.moveElsewhere(backToBody);
    }

    const pending = yield* f.begin(f.busyMessage(false));

    if (phase === "between scheduling and commit") {
      expect(
        pending.signal.kind,
        "movement race must begin with a queued restore"
      ).toBe("frame");
      f.moveElsewhere(backToBody);
    }

    yield* f.finish(pending);
    expect(
      f.restores,
      `must not restore after user moved focus ${phase}`
    ).toHaveBeenCalledTimes(0);
    expect(document.activeElement, `must not steal focus ${phase}`).not.toBe(
      f.field
    );
    expect(f.h.calls).toHaveLength(0);
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
);

it.effect.each([1280, 390])(
  "root real expiry while busy cancels restoration at %i",
  (width) =>
    Effect.gen(function* expired() {
      const f = yield* noteFocusFixture(width);
      yield* f.apply(f.busyMessage(true));
      yield* f.apply(Message.Ticked({ now: recoveryEnd }));
      yield* f.h.receive();
      expect(f.h.model().editing.rsvp.prepared).toBeUndefined();
      expect(f.h.model().editing.rsvp.note).toBe("Focus draft");
      yield* f.finish(yield* f.begin(f.busyMessage(false)));
      expect(
        f.restores,
        "retired preparation must not refocus on idle"
      ).toHaveBeenCalledTimes(0);
      expect(f.h.calls).toHaveLength(0);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
);

it.effect.each([1280, 390])(
  "root replaced preparation invalidates an already queued restore at %i",
  (width) =>
    Effect.gen(function* replaced() {
      const f = yield* noteFocusFixture(width);
      yield* f.apply(f.busyMessage(true));
      const pending = yield* f.begin(f.busyMessage(false));
      expect(pending.signal.kind).toBe("frame");
      const current = f.h.model().editing.rsvp;

      if (current.prepared === undefined) {
        return yield* Effect.die("Missing staged preparation");
      }

      yield* f.apply(
        Message.ReceivedEditing({
          notice: EditingNotice.cases.Rsvp.make({
            view: {
              ...current,
              prepared: PreparedRsvpNote.make({
                ...current.prepared,
                id: current.prepared.id + 1,
              }),
            },
          }),
          personId: upcomingPerson,
        })
      );
      yield* f.finish(pending);
      expect(
        f.restores,
        "replacement must invalidate the old generation callback"
      ).toHaveBeenCalledTimes(0);
      expect(f.h.calls).toHaveLength(0);

      return yield* Effect.void;
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
);

it.effect.each([1280, 390])(
  "root unfocused window discards rather than defers restoration at %i",
  (width) =>
    Effect.gen(function* unfocused() {
      const f = yield* noteFocusFixture(width);
      yield* f.apply(f.busyMessage(true));
      const pending = yield* f.begin(f.busyMessage(false));
      expect(pending.signal.kind).toBe("frame");
      f.setWindowFocused(false);
      yield* f.finish(pending);
      f.setWindowFocused(true);
      yield* f.apply(Message.CompletedRsvpNoteFocus());
      expect(
        f.restores,
        "unfocused window must discard, not defer"
      ).toHaveBeenCalledTimes(0);
      expect(f.h.calls).toHaveLength(0);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
);

it.effect.each(
  [1280, 390].flatMap((width) =>
    ["pointer", "tab", "window-blur"].map((intent) => ({ intent, width }))
  )
)("root interaction intent cancels ownership %j", ({ width, intent }) =>
  Effect.gen(function* interaction() {
    const f = yield* noteFocusFixture(width);
    yield* f.apply(f.busyMessage(true));

    if (intent === "pointer") {
      f.outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    } else if (intent === "tab") {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Tab" })
      );
    } else {
      window.dispatchEvent(new Event("blur"));
    }

    yield* f.finish(yield* f.begin(f.busyMessage(false)));
    expect(
      f.restores,
      "user intent must revoke restoration ownership"
    ).toHaveBeenCalledTimes(0);
    expect(f.h.calls).toHaveLength(0);
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
);

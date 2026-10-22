import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";

import { Message } from "../src/client/app.js";
import {
  DeleteOutcome,
  undoWindowMilliseconds,
} from "../src/client/editing/delete-actor.js";
import { DeleteNotice } from "../src/client/editing/deletion-session.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { EditorMutation } from "../src/client/editing/editor-session-model.js";
import { EditingNotice } from "../src/client/editing/runtime.js";
import {
  instantRuntimeFixture,
  nextInstantNotice,
} from "./instant-runtime-fixture.js";
import { modDeleteKey } from "./mod-delete-fixture.js";

const staged = (notice: typeof EditingNotice.Type) =>
  EditingNotice.guards.Editor(notice) &&
  Option.isSome(notice.mutation) &&
  EditorMutation.guards.DeletedStaged(notice.mutation.value);

const deleteHistory = Effect.fn("modDeleteHistory")(
  function* deleteHistory(input: {
    readonly alias: string;
    readonly shift: boolean;
    readonly platform: "MacIntel" | "Win32";
    readonly organizer: boolean;
    readonly recurring: boolean;
    readonly undo: boolean;
    readonly noGuests: boolean;
  }) {
    const h = yield* instantRuntimeFixture({ ...input, operation: "delete" });
    const key = modDeleteKey(h.model, input);
    expect(Option.isSome(key)).toBe(true);
    yield* h.dispatch(Option.getOrThrow(key));
    yield* nextInstantNotice(h.queue, staged);
    const before = yield* Ref.get(h.api.fake.requests);
    expect(before.every((request) => request.method === "GET")).toBe(true);

    const mark = (yield* Ref.get(h.state)).editing.deletes.find(
      (item) => item.phase === "pending"
    );

    if (mark === undefined) {
      return yield* Effect.die("Expected a staged deletion");
    }

    expect(mark.intent.request.scope).toBe("single");
    expect(mark.intent.event.organizer?.self).toBe(input.organizer);
    yield* h.dispatch(
      Message.EditingAction({
        action: input.undo
          ? EditorAction.cases.Undo.make({ id: mark.intent.id })
          : EditorAction.cases.DismissUndo.make({ id: mark.intent.id }),
      })
    );
    yield* nextInstantNotice(
      h.queue,
      (notice) =>
        EditingNotice.guards.Delete(notice) &&
        DeleteNotice.guards.Settled(notice.notice) &&
        notice.notice.outcome.id === mark.intent.id &&
        (input.undo
          ? DeleteOutcome.guards.Undone(notice.notice.outcome)
          : DeleteOutcome.guards.Committed(notice.notice.outcome))
    );
    yield* TestClock.adjust(undoWindowMilliseconds + 1);
    const after = yield* Ref.get(h.api.fake.requests);
    const writes = after.filter((request) => request.method !== "GET");
    expect(writes).toHaveLength(input.undo ? 0 : 1);

    if (input.undo) {
      expect(after).toEqual(before);
    }

    for (const write of writes) {
      expect(write.method).toBe("DELETE");
      expect(
        new URL(write.path, "https://fixture.invalid").searchParams.get(
          "sendUpdates"
        )
      ).toBe(input.shift ? "none" : "all");
      expect(write.path).toContain("/events/instant-instance");
      expect(write.path).not.toContain("/events/instant-series");
    }

    expect(h.views).not.toContain("Email");
    expect(h.views).not.toContain("Scope");
    expect(h.views).not.toContain("RemoveRecurrence");

    return yield* Effect.void;
  }
);

it.effect(
  "real Mod and Shift key aliases preserve roles and single occurrence while reaching fake Google with all versus none",
  () =>
    Effect.gen(function* aliasMatrix() {
      for (const alias of ["Delete", "Backspace", "Del"]) {
        for (const shift of [false, true]) {
          for (const platform of ["MacIntel", "Win32"] as const) {
            for (const organizer of [false, true]) {
              for (const recurring of [false, true]) {
                yield* deleteHistory({
                  alias,
                  noGuests: false,
                  organizer,
                  platform,
                  recurring,
                  shift,
                  undo: false,
                }).pipe(Effect.scoped);
              }
            }
          }
        }
      }
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect.prop(
  "generated native delete histories never mutate before commit or after Undo wins",
  {
    alias: Schema.Literals(["Delete", "Backspace", "Del"]),
    organizer: Schema.Boolean,
    platform: Schema.Literals(["MacIntel", "Win32"]),
    recurring: Schema.Boolean,
    shift: Schema.Boolean,
    undo: Schema.Boolean,
  },
  (input) =>
    deleteHistory({ ...input, noGuests: false }).pipe(
      Effect.scoped,
      Effect.provide(NodeServices.layer)
    )
);

it.effect(
  "events with no other guests use the same deletion and Undo behavior as Shift; Mod harmlessly carries all and has nobody to email",
  () =>
    Effect.gen(function* noGuestMatrix() {
      for (const shift of [false, true]) {
        for (const undo of [false, true]) {
          yield* deleteHistory({
            alias: "Backspace",
            noGuests: true,
            organizer: true,
            platform: "MacIntel",
            recurring: false,
            shift,
            undo,
          }).pipe(Effect.scoped);
        }
      }
    }).pipe(Effect.provide(NodeServices.layer))
);

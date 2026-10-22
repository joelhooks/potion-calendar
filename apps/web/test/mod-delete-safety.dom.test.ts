import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Ref, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message } from "../src/client/app.js";
import { BulkView } from "../src/client/bulk/model.js";
import { bulkSummary } from "../src/client/bulk/selection.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { DeleteOutcome } from "../src/client/editing/delete-actor.js";
import { DeleteNotice } from "../src/client/editing/deletion-session.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { EditingNotice } from "../src/client/editing/runtime.js";
import { editAction } from "../src/client/editing/update.js";
import { actionCatalog, keyHints } from "../src/client/keyboard/registry.js";
import { view } from "../src/features/app.js";
import { editingFixture } from "./editor-fixture.js";
import {
  instantRuntimeFixture,
  nextInstantNotice,
} from "./instant-runtime-fixture.js";
import { modDeleteKey } from "./mod-delete-fixture.js";

it.effect.prop(
  "real Mod and Shift aliases refuse read-only, unsupported, raw-master, editor and text targets without granting permission",
  {
    alias: Schema.Literals(["Delete", "Backspace", "Del"]),
    platform: Schema.Literals(["MacIntel", "Win32"]),
    refusal: Schema.Literals([
      "reader",
      "unsupported",
      "master",
      "editor",
      "text",
      "dialog",
    ]),
    shift: Schema.Boolean,
  },
  (input) =>
    Effect.gen(function* disabledDelete() {
      const h = yield* instantRuntimeFixture({
        eventType: input.refusal === "unsupported" ? "outOfOffice" : "default",
        operation: "delete",
        organizer: true,
        readOnly: input.refusal === "reader",
        recurring: false,
        undo: false,
      });

      let { model } = h;

      if (input.refusal === "master") {
        model = {
          ...model,
          calendar: {
            ...model.calendar,
            reads: model.calendar.reads.map((read) => ({
              ...read,
              events: RemoteEvents.Success({
                data: {
                  events: [{ ...h.source, recurrence: ["RRULE:FREQ=DAILY"] }],
                  versions: [],
                },
              }),
            })),
          },
        };
      }

      if (input.refusal === "editor") {
        model = {
          ...model,
          editing: { ...model.editing, view: editingFixture },
        };
      }

      const target = document.createElement(
        input.refusal === "text" ? "textarea" : "button"
      );

      if (input.refusal === "dialog") {
        const dialog = document.createElement("dialog");
        dialog.append(target);
      }

      expect(Option.isNone(modDeleteKey(model, { ...input, target }))).toBe(
        true
      );

      if (
        ["reader", "unsupported", "master", "editor"].includes(input.refusal)
      ) {
        const row = actionCatalog(model).find(
          (action) =>
            action.id === (input.shift ? "delete-no-email" : "delete-instantly")
        );

        expect(row?.availability(model)).toBe("disabled");

        const result = editAction(
          model,
          input.shift
            ? EditorAction.cases.DeleteNoEmail.make({})
            : EditorAction.cases.DeleteInstantly.make({})
        );

        expect(result.model).toBe(model);
        expect(result.commands).toBeUndefined();
      }

      expect(yield* Ref.get(h.api.fake.requests)).toHaveLength(0);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

const bulkAuthority = (input: {
  readonly guests: boolean;
  readonly organizer?: boolean;
  readonly authoritativeNoGuests?: boolean;
  readonly authoritativeOrganizer?: boolean;
}) => ({
  authoritativeNoGuests: input.authoritativeNoGuests ?? !input.guests,
  authoritativeOrganizer:
    input.authoritativeOrganizer ?? input.organizer ?? true,
  organizer: input.organizer ?? true,
});

const bulkHistory = Effect.fn("modDeleteBulkHistory")(
  function* bulkHistory(input: {
    readonly kind: "mod" | "shift" | "plain";
    readonly guests: boolean;
    readonly organizer?: boolean;
    readonly authoritativeNoGuests?: boolean;
    readonly authoritativeOrganizer?: boolean;
  }) {
    const h = yield* instantRuntimeFixture({
      ...bulkAuthority(input),
      bulk: true,
      mixedGuests: true,
      noGuests: !input.guests,
      operation: "delete",
      recurring: false,
      undo: false,
    });

    const before =
      input.kind === "plain"
        ? {
            ...h.model,
            calendar: {
              ...h.model.calendar,
              selected: h.model.calendar.selected.slice(0, 2),
            },
          }
        : h.model;

    yield* Ref.set(h.state, before);
    yield* h.dispatch(
      Option.getOrThrow(
        modDeleteKey(before, {
          alias: "Delete",
          mod: input.kind !== "plain",
          platform: "Win32",
          shift: input.kind === "shift",
        })
      )
    );
    yield* nextInstantNotice(
      h.queue,
      (notice) =>
        EditingNotice.guards.Bulk(notice) &&
        BulkView.guards.Settled(notice.view)
    );
    const model = yield* Ref.get(h.state);
    const summary = bulkSummary(model);
    expect(summary?.succeeded).toHaveLength(2);
    expect(summary?.skipped).toHaveLength(input.kind === "plain" ? 0 : 1);
    expect(
      (yield* Ref.get(h.api.fake.requests)).every(
        (request) => request.method === "GET"
      )
    ).toBe(true);

    const rendered = yield* renderToString(
      { init: () => ({ model }), view },
      { isHydratable: false }
    );

    const document = new DOMParser().parseFromString(
      rendered.html,
      "text/html"
    );

    const copy = document.querySelector(
      "[aria-label='Bulk action results']"
    )?.textContent;

    expect(copy).toContain("Deleted 2 events");

    if (input.kind !== "plain") {
      expect(copy).toContain("Couldn't delete 1 event");
    }

    if (input.kind === "mod") {
      const organizer = input.authoritativeOrganizer ?? input.organizer ?? true;
      const guests = !(input.authoritativeNoGuests ?? !input.guests);
      let expected = "Google may email the organizer.";

      if (organizer) {
        expected = guests ? "Guests will be notified." : "No email sent.";
      }

      expect(copy).toContain(expected);
      expect(copy?.includes("Guests will be notified.")).toBe(
        organizer && guests
      );
    } else {
      expect(copy).not.toContain("Guests will be notified.");
    }

    const pending = model.editing.deletes.filter(
      (mark) => mark.phase === "pending"
    );

    expect(pending).toHaveLength(2);

    for (const mark of pending) {
      yield* h.dispatch(
        Message.EditingAction({
          action: EditorAction.cases.DismissUndo.make({ id: mark.intent.id }),
        })
      );
      yield* nextInstantNotice(
        h.queue,
        (notice) =>
          EditingNotice.guards.Delete(notice) &&
          DeleteNotice.guards.Settled(notice.notice) &&
          notice.notice.outcome.id === mark.intent.id &&
          DeleteOutcome.guards.Committed(notice.notice.outcome)
      );
    }

    const writes = (yield* Ref.get(h.api.fake.requests)).filter(
      (request) => request.method !== "GET"
    );

    expect(writes).toHaveLength(2);

    for (const write of writes) {
      expect(
        new URL(write.path, "https://fixture.invalid").searchParams.get(
          "sendUpdates"
        )
      ).toBe(input.kind === "mod" ? "all" : "none");
      expect(write.path).not.toContain("instant-blocked");
    }

    expect(h.views).not.toContain("Email");
    expect(h.views).not.toContain("Scope");
  }
);

it.effect(
  "mixed guest and no-guest selection preserves partial results and per-event copy; plain bulk Delete and Shift keep their existing none requests",
  () =>
    Effect.gen(function* bulkMatrix() {
      for (const kind of ["mod", "shift", "plain"] as const) {
        for (const guests of [false, true]) {
          yield* bulkHistory({ guests, kind }).pipe(Effect.scoped);
        }
      }
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "bulk email copy follows the actual reread guests and organizer role in both drift directions, not cached selection facts",
  () =>
    Effect.gen(function* bulkAuthorityDrift() {
      yield* bulkHistory({
        authoritativeNoGuests: false,
        guests: false,
        kind: "mod",
      }).pipe(Effect.scoped);
      yield* bulkHistory({
        authoritativeNoGuests: true,
        guests: true,
        kind: "mod",
      }).pipe(Effect.scoped);
      yield* bulkHistory({
        authoritativeOrganizer: false,
        guests: true,
        kind: "mod",
        organizer: true,
      }).pipe(Effect.scoped);
      yield* bulkHistory({
        authoritativeOrganizer: true,
        guests: true,
        kind: "mod",
        organizer: false,
      }).pipe(Effect.scoped);
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "Delete instantly is advertised beside the no-email twin with the Mac Backspace hint",
  () =>
    Effect.gen(function* advertised() {
      const h = yield* instantRuntimeFixture({
        operation: "delete",
        organizer: true,
        recurring: false,
        undo: false,
      });

      const row = actionCatalog(h.model).find(
        (action) => action.id === "delete-instantly"
      );

      expect(row?.title).toBe("Delete instantly");
      expect(row?.availability(h.model)).toBe("enabled");
      expect(row === undefined ? [] : keyHints(row, "MacIntel")).toContain(
        "⌘⌫"
      );
      expect(EditorView.guards.Closed(h.model.editing.view)).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

import { expect, it } from "@effect/vitest";
import { Effect, Match, Option, Predicate } from "effect";
import { vi } from "vitest";

import { update } from "../src/client/app.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { draftEventFields } from "../src/layout/editor-fields.js";
import { dayFromIso, isoFromDay } from "../src/layout/navigation.js";
import { writeBody } from "./editing-rpc-fixture.js";
import { fulldayModel, mountedFullday } from "./fullday-fixture.js";
import type { FulldayScene } from "./fullday-fixture.js";
import { fulldaySession } from "./fullday-runtime-fixture.js";

const openHit = Effect.fn("test.openFullDayHit")(function* openHit(
  scene: FulldayScene,
  platform: string,
  minute: number
) {
  const h = yield* mountedFullday(fulldayModel(scene), platform);

  const cell = yield* Effect.fromNullishOr(
    Match.value(scene).pipe(
      Match.when("all-day", () =>
        [...h.root.querySelectorAll<HTMLElement>(".all-day-cell[data-day]")].at(
          -1
        )
      ),
      Match.when("month", () =>
        h.cells.find(
          (candidate) =>
            !isoFromDay(Number(candidate.dataset.day)).startsWith("2026-10")
        )
      ),
      Match.orElse(() => h.cells.at(-1))
    )
  );

  const date = isoFromDay(Number(cell.dataset.day));
  yield* h.click(cell, 100, minute);
  expect(h.commands).toEqual([]);
  yield* h.click(cell, 300, minute, { mod: true });
  expect(
    h.messages.filter((message) =>
      Predicate.isTagged(message, "CompletedGesture")
    )
  ).toHaveLength(1);
  expect(h.commands).toHaveLength(1);
  const command = yield* Effect.fromNullishOr(h.commands[0]);
  expect(command._tag).toBe("Open");
  const session = yield* fulldaySession(h.get(), command, date);
  const editor = session.opened.editing.view;
  expect(EditorView.guards.Editing(editor)).toBe(true);

  if (!EditorView.guards.Editing(editor)) {
    return yield* Effect.die("The actual editor did not open");
  }

  expect(editor.draft.allDay).toBe(true);
  expect(editor.draft.startDate).toBe(date);
  expect(editor.draft.endDate).toBe(date);
  expect(editor.draft.reminders).toEqual({ overrides: [], useDefault: false });

  return { date, h, session };
});

for (const platform of ["MacIntel", "Win32"]) {
  it.effect(
    `late-night native ${platform} pointer reaches one date-only editor and real fake-provider Save`,
    () =>
      Effect.gen(function* lateNativeSave() {
        const { date, session } = yield* openHit("timed", platform, 1439);

        const editor = yield* Effect.fromOption(
          Option.some(session.opened.editing.view).pipe(
            Option.filter(EditorView.guards.Editing)
          )
        );

        const fields = yield* draftEventFields(editor.draft);
        expect(fields.start).toEqual({ date });
        expect(fields.end).toEqual({ date: isoFromDay(dayFromIso(date) + 1) });
        expect(fields.reminders).toEqual({ overrides: [], useDefault: false });
        const saved = yield* session.save();
        expect(saved.rpc).toHaveLength(1);
        expect(saved.requests.map((request) => request.method)).toEqual([
          "GET",
          "POST",
        ]);
        const body = writeBody(saved.requests.at(-1)?.body);
        expect(body.start).toEqual({ date });
        expect(body.end).toEqual({ date: isoFromDay(dayFromIso(date) + 1) });
        expect(body.reminders).toEqual({ overrides: [], useDefault: false });
      }).pipe(Effect.scoped)
  );
}

for (const scene of ["all-day", "month", "multi-day", "travel"] as const) {
  it.effect(
    `native ${scene} full-day hit keeps its actual non-anchor date`,
    () =>
      Effect.gen(function* viewDate() {
        const { date, h, session } = yield* openHit(scene, "MacIntel", 1439);
        expect(dayFromIso(date)).not.toBe(h.get().calendar.navigation.anchor);

        if (scene === "travel") {
          expect(session.opened.calendar.zone).toBe("Pacific/Auckland");
          expect(session.opened.timeZones.preferences.primary.id).not.toBe(
            "Pacific/Auckland"
          );
        }
      }).pipe(Effect.scoped)
  );
}

for (const mod of [false, true]) {
  it.effect(
    `offline pointer preserves local draft opening with zero IO: fullDay=${mod}`,
    () =>
      Effect.gen(function* offlinePointer() {
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
          ),
          (mock) =>
            Effect.sync(() => {
              mock.mockRestore();
            })
        );
        const h = yield* mountedFullday(fulldayModel("timed"), "MacIntel");
        const cell = yield* Effect.fromNullishOr(h.cells.at(-1));
        yield* h.click(cell, 100, 540);
        yield* h.click(cell, 300, 540, { mod });
        expect(h.commands).toHaveLength(1);
        const command = yield* Effect.fromNullishOr(h.commands[0]);

        const session = yield* fulldaySession(
          h.get(),
          command,
          isoFromDay(Number(cell.dataset.day))
        );

        const editor = session.opened.editing.view;
        expect(EditorView.guards.Editing(editor) && editor.draft.allDay).toBe(
          mod
        );
      }).pipe(Effect.scoped)
  );
}

it.effect(
  "native full-day completion preserves person, host and writable-calendar fences",
  () =>
    Effect.gen(function* fullDayRecipients() {
      const { h, session } = yield* openHit("timed", "MacIntel", 1439);

      const message = yield* Effect.fromNullishOr(
        h.messages.find((item) => Predicate.isTagged(item, "CompletedGesture"))
      );

      const initial = fulldayModel("timed");
      expect(
        update(initial, {
          ...message,
          personId: "obsolete-person",
        }).commands?.filter((command) => command.name === "DispatchEditing") ??
          []
      ).toEqual([]);

      for (const model of [
        { ...initial, person: Option.none() },
        { ...initial, person: Option.some("other-person") },
        {
          ...initial,
          calendar: { ...initial.calendar, zone: "Pacific/Auckland" },
        },
      ]) {
        expect(
          update(model, message).commands?.filter(
            (command) => command.name === "DispatchEditing"
          ) ?? []
        ).toEqual([]);
      }

      expect(
        update(session.opened, message).commands?.filter(
          (command) => command.name === "DispatchEditing"
        ) ?? []
      ).toEqual([]);

      const refused = yield* mountedFullday(
        fulldayModel("refused"),
        "MacIntel"
      );

      const cell = yield* Effect.fromNullishOr(refused.cells.at(-1));
      yield* refused.click(cell, 100, 540);
      yield* refused.click(cell, 300, 540, { mod: true });
      expect(refused.commands).toEqual([]);
      expect(EditorView.guards.Closed(refused.get().editing.view)).toBe(true);
      expect(Option.isSome(refused.get().error)).toBe(true);
    }).pipe(Effect.scoped)
);

import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { changeConferencingSettings } from "../src/client/settings/conferencing/machine.js";
import type { ConferencingSettings } from "../src/client/settings/conferencing/model.js";
import {
  ConferencingSettingsChange as Change,
  initialConferencingSettings,
  normalizedVideoLink,
  validateVideoDraft,
} from "../src/client/settings/conferencing/model.js";
import {
  isDocumentRoute,
  parseRoute,
  printRoute,
  SettingsRoute,
} from "../src/layout/route.js";

const number = Schema.Int.check(
  Schema.isBetween({ maximum: 100_000, minimum: 0 })
);

it.effect(
  "the literal conferencing route round trips and is served as an application document",
  () =>
    Effect.sync(() => {
      const route = SettingsRoute.make({ page: "conferencing" });
      expect(parseRoute("/settings/conferencing")).toEqual(route);
      expect(printRoute(route)).toBe("/settings/conferencing");
      expect(isDocumentRoute("/settings/conferencing")).toBe(true);
      expect(isDocumentRoute("/conferencing")).toBe(false);
    })
);

it.effect.prop(
  "custom links prepend HTTPS and trim only outer whitespace while preserving name case and spacing",
  { token: number },
  ({ token }) =>
    Effect.sync(() => {
      const value = validateVideoDraft({
        id: Option.none(),
        link: `  room${token}.example/join  `,
        name: `  My  ROOM ${token}  `,
      });

      expect(Option.getOrThrow(value.value)).toEqual({
        link: `https://room${token}.example/join`,
        name: `My  ROOM ${token}`,
      });
      expect(value.errors).toEqual({
        link: Option.none(),
        name: Option.none(),
      });
    })
);

it.effect.prop(
  "explicit non-web schemes never become clickable video links through fallback",
  {
    scheme: Schema.Literals([
      "javascript",
      "data",
      "file",
      "ftp",
      "mailto",
      "zoommtg",
    ]),
    token: number,
  },
  ({ scheme, token }) =>
    Effect.sync(() => {
      const link = `${scheme}:${token}`;
      expect(Option.isNone(normalizedVideoLink(link))).toBe(true);

      const invalid = validateVideoDraft({
        id: Option.none(),
        link,
        name: "Room",
      });

      expect(Option.getOrThrow(invalid.errors.link)).toBe(
        "Must be a valid URL"
      );
      expect(Option.isNone(invalid.value)).toBe(true);
    })
);

it.effect.prop(
  "failed saves restore the exact draft, stale completions cannot settle it, and cancel changes no saved entry",
  { token: number },
  ({ token }) =>
    Effect.sync(() => {
      const entry = {
        id: "existing",
        link: "https://existing.example/",
        name: "Saved room",
      };

      const initial = { ...initialConferencingSettings(), entries: [entry] };

      const opened = changeConferencingSettings(
        initial,
        Change.cases.Edit.make({ id: entry.id })
      );

      const named = changeConferencingSettings(
        opened,
        Change.cases.Name.make({ value: `  Draft ${token}  ` })
      );

      const draft = changeConferencingSettings(
        named,
        Change.cases.Link.make({ value: `draft${token}.example/room` })
      );

      const saving = changeConferencingSettings(
        draft,
        Change.cases.Save.make({})
      );

      expect(saving.mode).toBe("saving");
      expect(saving.entries).toEqual([entry]);
      expect(
        changeConferencingSettings(
          saving,
          Change.cases.Saved.make({
            entries: [],
            requestId: saving.requestId + 1,
          })
        )
      ).toEqual(saving);
      expect(
        changeConferencingSettings(
          saving,
          Change.cases.Name.make({ value: "Lost edit" })
        )
      ).toEqual(saving);

      const failed = changeConferencingSettings(
        saving,
        Change.cases.Failed.make({
          message: "Storage unavailable",
          requestId: saving.requestId,
        })
      );

      expect(failed.mode).toBe("editing");
      expect(failed.draft).toEqual(draft.draft);
      expect(failed.entries).toEqual([entry]);
      expect(Option.getOrThrow(failed.error)).toBe("Storage unavailable");

      const cancelled = changeConferencingSettings(
        failed,
        Change.cases.Cancel.make({})
      );

      expect(cancelled.mode).toBe("listing");
      expect(cancelled.entries).toEqual([entry]);
      expect(cancelled.draft).toEqual(initialConferencingSettings().draft);
    })
);

it.effect.prop(
  "generated remove and retry histories keep committed rows until a matching success",
  { failures: Schema.Array(Schema.Boolean).check(Schema.isMaxLength(12)) },
  ({ failures }) =>
    Effect.sync(() => {
      const entries = [
        { id: "first", link: "https://first.example/", name: "Same name" },
        { id: "second", link: "https://second.example/", name: "Same name" },
      ];

      let state: typeof ConferencingSettings.Type = {
        ...initialConferencingSettings(),
        entries,
      };

      let expected = entries;

      for (const fails of failures) {
        if (expected.length === 0) {
          expect(
            changeConferencingSettings(
              state,
              Change.cases.Remove.make({ id: "first" })
            )
          ).toEqual(state);
          continue;
        }

        const id = expected[0]?.id ?? "";
        state = changeConferencingSettings(
          state,
          Change.cases.Remove.make({ id })
        );
        expect(state.mode).toBe("removing");
        expect(state.entries).toEqual(expected);

        if (fails) {
          state = changeConferencingSettings(
            state,
            Change.cases.Failed.make({
              message: "Remove failed",
              requestId: state.requestId,
            })
          );
          expect(state.mode).toBe("listing");
          expect(Option.isSome(state.error)).toBe(true);
        } else {
          expected = expected.filter((entry) => entry.id !== id);
          state = changeConferencingSettings(
            state,
            Change.cases.Saved.make({
              entries: expected,
              requestId: state.requestId,
            })
          );
        }

        expect(state.entries).toEqual(expected);
      }
    })
);

it.effect(
  "required fields and invalid links remain in the editable form without a save transition",
  () =>
    Effect.sync(() => {
      const opened = changeConferencingSettings(
        initialConferencingSettings(),
        Change.cases.Add.make({})
      );

      const invalid = changeConferencingSettings(
        opened,
        Change.cases.Save.make({})
      );

      expect(invalid.mode).toBe("editing");
      expect(Option.getOrThrow(invalid.errors.name)).toBe("Name is required");
      expect(Option.getOrThrow(invalid.errors.link)).toBe(
        "Conferencing link is required"
      );
      expect(invalid.requestId).toBe(opened.requestId);
    })
);

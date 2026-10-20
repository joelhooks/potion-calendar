import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { EditorView } from "../src/client/editing/editor-model.js";
import { GestureResult } from "../src/client/editing/gesture-model.js";
import { view } from "../src/features/app.js";
import {
  canonicalClockInput,
  clockInputLabel,
} from "../src/layout/settings-time-input.js";
import { editorViewFields } from "./editor-fixture.js";
import { fixtureSelection } from "./fixture.js";

it.effect.each(["12", "24"] as const)(
  "the %s-hour preference reaches chips, hour axis, previews, editor and details",
  (format) =>
    Effect.gen(function* clockSurfaces() {
      const initial = fixtureSelection();

      const model = {
        ...initial,
        editing: {
          ...initial.editing,
          gesture: Option.some(
            GestureResult.make({
              allDayRow: false,
              duplicate: false,
              id: 1,
              range: {
                allDay: false,
                endDate: "2026-10-19",
                endTime: "14:00",
                startDate: "2026-10-19",
                startTime: "12:30",
              },
              target: Option.none(),
            })
          ),
          view: EditorView.cases.Editing.make(editorViewFields),
        },
        settings: { ...initial.settings, timeFormat: format },
      };

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      for (const selector of [
        ".event-time",
        ".time-labels",
        ".gesture-preview span",
        ".detail-time",
      ]) {
        const labels = [...document.querySelectorAll(selector)];
        expect(labels.length, selector).toBeGreaterThan(0);

        for (const label of labels) {
          if (format === "24") {
            expect(label.textContent, selector).not.toMatch(
              /\b\d(?::\d\d)?(?:am|pm)\b/iu
            );
          } else {
            expect(label.textContent, selector).toMatch(/am|pm/iu);
          }
        }
      }

      const editor =
        document.querySelector<HTMLInputElement>("#event-startTime");

      expect(editor?.type).toBe("text");
      expect(editor?.value).toBe(
        clockInputLabel(editorViewFields.draft.startTime, format)
      );

      if (format === "24") {
        expect(document.body.textContent).not.toMatch(
          /\b\d+(?::\d\d)?(?:am|pm)\b/iu
        );
        expect(
          [...document.querySelectorAll<HTMLInputElement>("input")]
            .map((element) => element.value)
            .join(" ")
        ).not.toMatch(/\b\d+(?::\d\d)?(?:am|pm)\b/iu);
        expect(rendered.html).not.toMatch(/\b\d+(?::\d\d)?(?:am|pm)\b/iu);
      }
    })
);

it.effect(
  "editor clock input preserves canonical wall times including noon and midnight",
  () =>
    Effect.sync(() => {
      for (const [label, canonical] of [
        ["12am", "00:00"],
        ["12pm", "12:00"],
        ["2:05pm", "14:05"],
        ["09:45", "09:45"],
        ["11:59 AM", "11:59"],
      ]) {
        expect(canonicalClockInput(label ?? "")).toBe(canonical);
      }

      for (const invalid of ["13pm", "25:00", "9:75am", "later"]) {
        expect(canonicalClockInput(invalid)).toBe(invalid);
      }
    })
);

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { renderToString } from "foldkit/experimental/server";
import type { HtmlBuilder } from "foldkit/html";

import type { EventDraftValue } from "../src/client/editing/editor-model.js";
import { editorZoneExplanation } from "../src/features/editor-zone-explanation.js";
import type { ResolvedTimeFormat } from "../src/layout/time-format.js";
import { editorDraft } from "./editor-fixture.js";

const renderExplanation = (
  draft: EventDraftValue,
  primaryZone: string,
  timeFormat: ResolvedTimeFormat = "12"
) =>
  renderToString(
    {
      init: () => ({ model: draft }),
      view: (model, h: HtmlBuilder<never>) => ({
        body: h.div(
          [],
          editorZoneExplanation(h, { draft: model, primaryZone, timeFormat })
        ),
        title: "Event time-zone explanation",
      }),
    },
    { isHydratable: false }
  ).pipe(
    Effect.map(({ html }) => new DOMParser().parseFromString(html, "text/html"))
  );

it.effect.each([
  {
    clock: "09:00",
    date: "2026-10-19",
    eventZone: "Asia/Tokyo",
    expected:
      "Start: 9am Asia/Tokyo · 5pm on the previous day in your primary zone (America/Los_Angeles).",
    primaryZone: "America/Los_Angeles",
  },
  {
    clock: "18:00",
    date: "2026-10-19",
    eventZone: "America/Los_Angeles",
    expected:
      "Start: 6pm America/Los_Angeles · 10am on the next day in your primary zone (Asia/Tokyo).",
    primaryZone: "Asia/Tokyo",
  },
  {
    clock: "09:00",
    date: "2026-10-19",
    eventZone: "America/Los_Angeles",
    expected:
      "Start: 9am America/Los_Angeles · 9am in your primary zone (America/Los_Angeles).",
    primaryZone: "America/Los_Angeles",
  },
  {
    clock: "01:00",
    date: "2026-01-03",
    eventZone: "Pacific/Kiritimati",
    expected:
      "Start: 1am Pacific/Kiritimati · 11pm on Thursday, January 1 in your primary zone (Etc/GMT+12).",
    primaryZone: "Etc/GMT+12",
  },
  {
    clock: "23:00",
    date: "2026-01-01",
    eventZone: "Etc/GMT+12",
    expected:
      "Start: 11pm Etc/GMT+12 · 1am on Saturday, January 3 in your primary zone (Pacific/Kiritimati).",
    primaryZone: "Pacific/Kiritimati",
  },
  {
    clock: "01:00",
    date: "2026-01-01",
    eventZone: "Pacific/Kiritimati",
    expected:
      "Start: 1am Pacific/Kiritimati · 11pm on Tuesday, December 30, 2025 in your primary zone (Etc/GMT+12).",
    primaryZone: "Etc/GMT+12",
  },
  {
    clock: "09:00",
    date: "2026-03-08",
    eventZone: "Asia/Tokyo",
    expected:
      "Start: 9am Asia/Tokyo · 4pm on the previous day in your primary zone (America/Los_Angeles).",
    primaryZone: "America/Los_Angeles",
  },
  {
    clock: "09:00",
    date: "2026-03-09",
    eventZone: "Asia/Tokyo",
    expected:
      "Start: 9am Asia/Tokyo · 5pm on the previous day in your primary zone (America/Los_Angeles).",
    primaryZone: "America/Los_Angeles",
  },
])(
  "the event/primary preview uses actual calendar-day differences: $date $eventZone",
  (input) =>
    Effect.gen(function* primaryZoneCopy() {
      const draft = {
        ...editorDraft,
        startDate: input.date,
        startTime: input.clock,
        timeZone: input.eventZone,
      };

      const document = yield* renderExplanation(draft, input.primaryZone);
      const explanation = document.querySelector("#event-zone-explanation");
      expect(explanation?.getAttribute("aria-live")).toBe("polite");
      expect(explanation?.querySelectorAll("p")[0]?.textContent).toBe(
        "Changing the zone keeps the dates and times you entered."
      );
      expect(explanation?.querySelectorAll("p")[1]?.textContent).toBe(
        input.expected
      );
      expect(draft).toMatchObject({
        startDate: input.date,
        startTime: input.clock,
        timeZone: input.eventZone,
      });
    })
);

it.effect("the explanation respects the shared 24-hour formatter", () =>
  Effect.gen(function* clockFormat() {
    const document = yield* renderExplanation(
      {
        ...editorDraft,
        startDate: "2026-07-01",
        startTime: "09:00",
        timeZone: "UTC",
      },
      "Europe/London",
      "24"
    );

    expect(
      document.querySelector("#event-zone-explanation p:last-child")
        ?.textContent
    ).toBe("Start: 09:00 UTC · 10:00 in your primary zone (Europe/London).");
  })
);

it.effect.each([
  {
    clock: "02:30",
    date: "2026-03-08",
    eventZone: "America/Los_Angeles",
    primaryZone: "UTC",
  },
  { clock: "25:00", date: "2026-10-19", eventZone: "UTC", primaryZone: "UTC" },
  { clock: "09:00", date: "2026-02-30", eventZone: "UTC", primaryZone: "UTC" },
  {
    clock: "09:00",
    date: "2026-10-19",
    eventZone: "UTC",
    primaryZone: "<script>unsafe</script>",
  },
])("invalid preview data never invents an instant: $date $clock", (input) =>
  Effect.gen(function* invalidPreview() {
    const document = yield* renderExplanation(
      {
        ...editorDraft,
        startDate: input.date,
        startTime: input.clock,
        timeZone: input.eventZone,
      },
      input.primaryZone
    );

    expect(
      document.querySelector("#event-zone-explanation p:last-child")
        ?.textContent
    ).toBe("Primary-zone preview is unavailable for this date, time or zone.");
    expect(document.querySelectorAll("script")).toHaveLength(0);
  })
);

it.effect(
  "all-day events have no zone explanation or misleading unavailable-time copy",
  () =>
    Effect.gen(function* allDayExplanation() {
      const document = yield* renderExplanation(
        { ...editorDraft, allDay: true },
        "America/Los_Angeles"
      );

      expect(document.querySelector("#event-zone-explanation")).toBeNull();
      expect(document.body.textContent).not.toContain("Primary-zone preview");
    })
);

import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { view } from "../src/features/app.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { copyFixtureEvents, copyFixtureModel } from "./equivalent-fixture.js";
import { measureRibbonContainment } from "./ribbon-containment.js";

const render = (model: AppModel) =>
  renderToString({ init: () => ({ model }), view }, { isHydratable: false });

const documentFor = (html: string): Document =>
  new DOMParser().parseFromString(html, "text/html");

it.effect(
  "a selected invitation keeps its identity when a preferred account copy arrives later",
  () =>
    Effect.sync(() => {
      const base = copyFixtureModel();

      const waiting = {
        ...base,
        calendar: {
          ...base.calendar,
          reads: base.calendar.reads.map((read) =>
            read.accountId === "work"
              ? { ...read, events: RemoteEvents.Loading() }
              : read
          ),
        },
      };

      const original = visibleEvents(waiting).find((event) => !event.allDay);
      expect(original).toBeDefined();

      if (original === undefined) {
        return;
      }

      const selected = update(
        waiting,
        Message.ClickedEvent({ key: original.key })
      ).model;

      const received = update(
        selected,
        Message.ReceivedEvents({
          accountId: "work",
          request: selected.calendar.rangeRequest,
          result: {
            events: copyFixtureEvents.filter(
              (event) => event.accountId === "work"
            ),
            versions: [],
          },
        })
      ).model;

      const detail = visibleEvents(received).find((event) => event.selected);
      expect(detail?.key).toBe(original.key);
      expect(detail?.source.accountId).toBe("work");
      expect(detail?.copies).toHaveLength(2);
    })
);

it.effect(
  "merged timed and all-day chips retain each calendar ribbon and detail membership",
  () =>
    Effect.gen(function* mergedView() {
      const base = copyFixtureModel();

      const merged = visibleEvents(base).find(
        (event) => !event.allDay && event.copies.length === 2
      );

      expect(merged).toBeDefined();

      if (merged === undefined) {
        return;
      }

      const { model } = update(
        { ...base, calendar: { ...base.calendar, viewportWidth: 920 } },
        Message.ClickedEvent({ key: merged.key })
      );

      const rendered = yield* render(model);
      const document = documentFor(rendered.html);
      const chips = [...document.querySelectorAll<HTMLElement>(".event-chip")];
      expect(chips).toHaveLength(3);
      const shared = chips.find((chip) => chip.dataset.eventKey === merged.key);
      expect(shared?.querySelectorAll(".calendar-ribbon")).toHaveLength(2);
      expect(
        document.querySelector(".all-day .calendar-ribbons")?.children
      ).toHaveLength(2);
      expect(
        [...document.querySelectorAll(".detail-calendar")].map(
          (row) => row.textContent
        )
      ).toEqual([
        "Work · owner@example.test",
        "Personal · personal@example.test",
      ]);
      expect(
        document.querySelector(".merge-toggle")?.getAttribute("aria-checked")
      ).toBe("true");
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");
      const styled = globalThis.document.createElement("section");
      styled.innerHTML = `<style>${css}</style>${rendered.html}`;
      globalThis.document.body.append(styled);

      try {
        for (const chip of styled.querySelectorAll(".event-chip")) {
          expect(["relative", "absolute"]).toContain(
            getComputedStyle(chip).position
          );
        }

        const withoutLayout = measureRibbonContainment(globalThis.document);
        expect(withoutLayout).toMatchObject({
          allDay: 2,
          passed: false,
          timed: 3,
        });
      } finally {
        styled.remove();
      }

      yield* fs.writeFileString(
        "../../.git/week-view-merge-fixture.html",
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Equivalent calendar copies</title><style>${css}</style></head><body>${rendered.html}<script>const viewport=document.querySelector('#time-viewport');if(viewport){viewport.scrollTop=Math.max(0,504-viewport.clientHeight/3)}window.__ribbonContainment=(${measureRibbonContainment.toString()})(document);if(!window.__ribbonContainment.passed){throw new Error('Calendar ribbon containment failed: '+JSON.stringify(window.__ribbonContainment))}</script></body></html>`
      );
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "the local merge toggle restores all source chips without mutating or re-reading provider data",
  () =>
    Effect.gen(function* unmergedView() {
      const base = copyFixtureModel();
      const result = update(base, Message.ClickedMergeDuplicates());
      expect(result.model.calendar.mergeDuplicates).toBe(false);
      expect(result.model.calendar.reads).toBe(base.calendar.reads);
      expect(result.commands?.map((command) => command.name)).toEqual([
        "SavePreferences",
      ]);
      expect(visibleEvents(result.model)).toHaveLength(
        copyFixtureEvents.length
      );
      const document = documentFor((yield* render(result.model)).html);
      expect(document.querySelectorAll(".event-chip")).toHaveLength(5);
      expect(
        document.querySelector(".merge-toggle")?.getAttribute("aria-checked")
      ).toBe("false");

      const restored = update(
        result.model,
        Message.ClickedMergeDuplicates()
      ).model;

      expect(visibleEvents(restored)).toHaveLength(3);
    })
);

it.effect(
  "hiding a merged calendar removes only that ribbon and uses the remaining copy for details",
  () =>
    Effect.gen(function* hiddenCopy() {
      const result = update(
        copyFixtureModel(),
        Message.ClickedCalendar({ accountId: "work", calendarId: "primary" })
      );

      const shown = visibleEvents(result.model);
      expect(shown).toHaveLength(0);

      const events = copyFixtureEvents.filter(
        (event) => event.accountId === "personal"
      );

      const request = result.model.calendar.rangeRequest;

      const received = update(
        result.model,
        Message.ReceivedEvents({
          accountId: "personal",
          request,
          result: { events, versions: [] },
        })
      ).model;

      expect(visibleEvents(received)).toHaveLength(2);
      const selected = visibleEvents(received).find((event) => !event.allDay);
      expect(selected?.copies).toHaveLength(1);

      if (selected !== undefined) {
        const { model } = update(
          received,
          Message.ClickedEvent({ key: selected.key })
        );

        const document = documentFor((yield* render(model)).html);
        expect(
          [...document.querySelectorAll(".detail-calendar")].map(
            (row) => row.textContent
          )
        ).toEqual(["Personal · personal@example.test"]);
      }
    })
);

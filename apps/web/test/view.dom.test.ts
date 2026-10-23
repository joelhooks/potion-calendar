import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { RemoteEvents, eventKey } from "../src/client/calendar-state.js";
import { view } from "../src/features/app.js";
import { fixtureEvents, fixtureModel, fixtureSelection } from "./fixture.js";

const render = (model: AppModel) =>
  renderToString({ init: () => ({ model }), view }, { isHydratable: false });

const documentFor = (html: string): Document =>
  new DOMParser().parseFromString(html, "text/html");

it.effect(
  "fixture week renders observed widths, statuses, current time, and visibility filters",
  () =>
    Effect.gen(function* fixtureDom() {
      const rendered = yield* render(fixtureModel());
      const document = documentFor(rendered.html);

      const buttons = [
        ...document.querySelectorAll<HTMLButtonElement>(".event-chip"),
      ];

      const review = buttons.find((button) =>
        button.textContent?.includes("Product review")
      );

      const design = buttons.find((button) =>
        button.textContent?.includes("Design session")
      );

      expect(review?.style.width).toBe("calc(75% - 3px)");
      expect(design?.style.left).toBe("calc(50% + 1px)");
      expect(design?.style.width).toBe("calc(50% - 3px)");
      expect(document.querySelector(".status-declined")?.textContent).toContain(
        "Optional planning"
      );
      expect(
        document.querySelector(".status-unanswered")?.textContent
      ).toContain("Project catch-up");
      expect(
        document.querySelector(".status-tentative")?.textContent
      ).toContain("Lunch with Sam");
      expect(document.querySelector<HTMLElement>(".now-line")?.style.top).toBe(
        "504px"
      );
      expect(document.querySelectorAll(".now-today")).toHaveLength(1);
      expect(document.querySelectorAll(".day-column")).toHaveLength(7);
      expect(document.body.textContent).not.toContain("Hidden calendar secret");
      expect(document.body.textContent).not.toContain("Cancelled meeting");
      expect(document.body.textContent).toContain("Reconnect");
      expect(document.body.textContent).toContain("Ship the calendar");
    })
);

it.effect(
  "detail selection keeps meeting fields read-only while exposing the person's own RSVP note",
  () =>
    Effect.gen(function* detailDom() {
      const model = fixtureSelection();
      const rendered = yield* render(model);
      const document = documentFor(rendered.html);

      expect(document.querySelector(".detail-panel h2")?.textContent).toBe(
        "Product review"
      );
      expect(document.querySelector(".detail-date")?.textContent).toBe(
        "Monday, October 19, 2026"
      );
      expect(document.querySelector(".detail-time")?.textContent).toBe(
        "9am – 10am · America/Los_Angeles"
      );
      expect(document.querySelector(".join-link")?.tagName).toBe("BUTTON");
      expect(document.querySelector(".detail-panel")?.textContent).toContain(
        "Alex"
      );
      expect(
        [...document.querySelectorAll(".attendee-response")].map(
          (response) => response.textContent
        )
      ).toEqual(["Yes", "Yes"]);
      expect(
        document.querySelectorAll(
          ".detail-panel input, .detail-panel textarea:not(#rsvp-note)"
        )
      ).toHaveLength(0);
      expect(document.querySelector("#rsvp-note")).not.toBeNull();
      const [event] = fixtureEvents;

      if (event !== undefined) {
        const altered = {
          ...model,
          calendar: {
            ...model.calendar,
            reads: [
              {
                accountId: "work",
                events: RemoteEvents.Success({
                  data: {
                    events: [
                      {
                        ...event,
                        description: '<img src=x onerror="alert(1)">',
                      },
                    ],
                    versions: [],
                  },
                }),
              },
            ],
          },
        } satisfies AppModel;

        const unsafe = documentFor((yield* render(altered)).html);
        expect(unsafe.querySelector(".description img")).toBeNull();
        expect(unsafe.querySelector(".description")?.textContent).toContain(
          "<img"
        );
        expect(model.calendar.selected.includes(eventKey(event))).toBe(true);
      }
    })
);

it.effect("declined and month overflow controls change the rendered view", () =>
  Effect.gen(function* viewModes() {
    const hidden = update(fixtureModel(), Message.ClickedDeclined()).model;
    expect(
      documentFor((yield* render(hidden)).html).querySelector(
        ".status-declined"
      )
    ).toBeNull();

    const month = update(
      fixtureModel(),
      Message.ClickedView({ days: 7, mode: "month" })
    ).model;

    const fullMonth = documentFor((yield* render(month)).html);
    expect(fullMonth.querySelectorAll(".month-week")).toHaveLength(18);
    expect(fullMonth.querySelectorAll(".month-cell")).toHaveLength(126);
    const weekdays = update(month, Message.ClickedWeekends()).model;
    expect(
      documentFor((yield* render(weekdays)).html).querySelectorAll(
        ".month-cell"
      )
    ).toHaveLength(90);
  })
);

it.effect(
  "exports the actual Foldkit fixture view for screenshot evidence",
  () =>
    Effect.gen(function* fixtureArtifact() {
      const fs = yield* FileSystem.FileSystem;
      const rendered = yield* render(fixtureSelection());
      const css = yield* fs.readFileString("src/client/style.css");
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fixture week</title><style>${css}</style></head><body>${rendered.html}<script>const viewport=document.querySelector('#time-viewport');if(viewport){viewport.scrollTop=Math.max(0,504-viewport.clientHeight/3)}</script></body></html>`;
      yield* fs.writeFileString("../../.git/week-view-fixture.html", html);
      expect(rendered.html).toContain("Product review");
    }).pipe(Effect.provide(NodeServices.layer))
);

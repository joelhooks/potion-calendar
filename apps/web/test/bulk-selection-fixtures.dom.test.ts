import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";

import type { AppModel } from "../src/client/app.js";
import { BulkView, BulkExecution } from "../src/client/bulk/model.js";
import { bulkPlanFor } from "../src/client/bulk/selection.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { DeleteIntent } from "../src/client/editing/delete-actor.js";
import { DeleteCommand } from "../src/client/editing/deletion-session.js";
import { EditorMutation } from "../src/client/editing/editor-session-model.js";
import { DeleteMark } from "../src/client/editing/ui-model.js";
import { view } from "../src/features/app.js";
import { BulkReceipt, BulkUndo } from "../src/layout/bulk-plans.js";
import { isoFromDay } from "../src/layout/navigation.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { bulkRootFixture } from "./bulk-root-fixture.js";

const fixtureFor = (
  scenario: "week" | "month" | "partial-delete" | "duplicate" | "rectangle",
  width: number,
  theme: "light" | "dark"
): AppModel => {
  const fixture = bulkRootFixture(scenario === "month");

  const [source] = fixture.events;
  const [shown] = visibleEvents(fixture.model);

  if (source === undefined || shown === undefined) {
    throw new Error("Missing unselected comparison fixture.");
  }

  const comparison = {
    ...source,
    attendees: [],
    end: { dateTime: `${isoFromDay(shown.startDay)}T17:00:00-07:00` },
    eventId: "bulk-unselected",
    iCalUID: "bulk-unselected@example.test",
    start: { dateTime: `${isoFromDay(shown.startDay)}T16:00:00-07:00` },
    title: "Delta · unselected",
  };

  let model: AppModel = {
    ...fixture.model,
    calendar: {
      ...fixture.model.calendar,
      reads: [
        {
          accountId: source.accountId,
          events: RemoteEvents.Success({
            data: { events: [...fixture.events, comparison], versions: [] },
          }),
        },
      ],
      selected:
        scenario === "rectangle" ? fixture.keys.slice(0, 2) : fixture.keys,
      viewport: 844,
      viewportWidth: width - (width <= 1000 ? 445 : 520),
    },
    settings: { ...fixture.model.settings, theme },
  };

  if (scenario === "rectangle") {
    model = {
      ...model,
      calendar: {
        ...model.calendar,
        rectangle: Option.some({
          height: 180,
          left: width <= 1000 ? 240 : 280,
          top: 260,
          width: 190,
        }),
      },
    };
  }

  if (scenario !== "partial-delete" && scenario !== "duplicate") {
    return model;
  }

  const operation = scenario === "duplicate" ? "duplicate" : "delete";
  const plan = bulkPlanFor(model, operation);
  const [first, second] = plan.steps;

  if (first === undefined || second === undefined) {
    throw new Error("Missing bulk result fixture steps.");
  }

  const intent = DeleteIntent.make({
    event: first.request.event,
    id: "fixture-undo-alpha",
    navigation: model.calendar.navigation,
    request: {
      accountId: first.request.event.accountId,
      calendarId: first.request.event.calendarId,
      eventId: first.request.event.eventId,
      scope: "single",
      sendUpdates: "none",
    },
    selection: Option.some(first.key),
    title: "Alpha",
  });

  const receipts = plan.steps.map((step, index) =>
    index === 1
      ? BulkReceipt.cases.Failed.make({
          key: step.key,
          reason: "Google says this event can no longer be changed.",
        })
      : BulkReceipt.cases.Succeeded.make({
          key: step.key,
          undo:
            operation === "delete"
              ? BulkUndo.cases.Available.make({
                  request: DeleteCommand.cases.Undo.make({ id: intent.id }),
                })
              : BulkUndo.cases.Unavailable.make({
                  reason: "The existing duplicate path does not support Undo.",
                }),
        })
  );

  const execution = BulkExecution.make({
    id: `fixture-${scenario}`,
    mutations:
      operation === "delete"
        ? [EditorMutation.cases.DeletedStaged.make({ id: intent.id, intent })]
        : [],
    plan,
    receipts,
    selection: fixture.keys,
  });

  return {
    ...model,
    calendar: {
      ...model.calendar,
      selected: operation === "delete" ? fixture.keys.slice(1) : fixture.keys,
    },
    editing: {
      ...model.editing,
      bulk: BulkView.cases.Settled.make({ execution }),
      deletes:
        operation === "delete"
          ? [
              DeleteMark.make({
                afterRead: Option.none(),
                intent,
                phase: "pending",
              }),
            ]
          : [],
    },
  };
};

it.effect(
  "exports fresh actual-app selection, month, rectangle and partial-result fixtures for desk-only browser capture",
  () =>
    Effect.gen(function* bulkSelectionArtifacts() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      for (const width of [1440, 900]) {
        for (const theme of ["light", "dark"] as const) {
          for (const scenario of [
            "week",
            "month",
            "partial-delete",
            "duplicate",
            "rectangle",
          ] as const) {
            const model = fixtureFor(scenario, width, theme);

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const dom = new DOMParser().parseFromString(
              rendered.html,
              "text/html"
            );

            expect(dom.querySelector(".bulk-detail h2")?.textContent).toBe(
              `${model.calendar.selected.length} events selected`
            );
            expect(dom.querySelectorAll(".bulk-detail button")).toHaveLength(3);
            expect(dom.querySelector(".bulk-detail .event-rsvp")).toBeNull();
            expect(dom.querySelector(".undo-toast")).toBeNull();

            if (scenario === "partial-delete") {
              expect(dom.querySelector(".bulk-notice")?.textContent).toContain(
                "Beta: Google says this event can no longer be changed."
              );
              expect(dom.querySelector(".bulk-notice")?.textContent).toContain(
                "Gamma"
              );
              expect(dom.querySelector(".bulk-notice")?.textContent).toContain(
                "Deleted 1 event"
              );
            }

            if (scenario === "duplicate") {
              expect(dom.querySelector(".bulk-notice")?.textContent).toContain(
                "Copies can't be undone; delete them if needed."
              );
            }

            const selectedKeys = JSON.stringify(model.calendar.selected);

            const comparisonKey = JSON.stringify(
              visibleEvents(model).find(
                (event) => event.source.eventId === "bulk-unselected"
              )?.key
            );

            const proof = `document.fonts.ready.then(()=>requestAnimationFrame(()=>{const selected=${selectedKeys};const comparison=${comparisonKey};const all=[...document.querySelectorAll('.event-chip')];const month=document.querySelector('#month-viewport');const firstRow=document.querySelector('.month-week:not([data-month-parked])');if(month&&firstRow)month.scrollTop=firstRow.getBoundingClientRect().height*6;const timed=document.querySelector('#time-viewport');const alpha=all.find(node=>node.dataset.eventKey===selected[0]);if(timed&&alpha&&timed.contains(alpha))timed.scrollTop=Math.max(0,alpha.getBoundingClientRect().top-timed.getBoundingClientRect().top-120);const rects=selected.map(key=>{const fragments=all.filter(node=>node.dataset.eventKey===key&&node.classList.contains('selected'));const visible=fragments.find(node=>{const box=node.getBoundingClientRect();const clip=node.closest('#time-viewport,#month-viewport,.all-day')?.getBoundingClientRect();return box.width>0&&box.height>0&&(!clip||Math.min(box.bottom,clip.bottom)>Math.max(box.top,clip.top)&&Math.min(box.right,clip.right)>Math.max(box.left,clip.left));});if(!visible)throw Error('Selected id has no visible selected fragment: '+key);return visible.getBoundingClientRect();});if(!all.some(node=>node.dataset.eventKey===comparison&&!node.classList.contains('selected')))throw Error('No unselected comparison event');const panel=document.querySelector('.bulk-detail');if(!panel||panel.querySelector('h2').textContent!=='${model.calendar.selected.length} events selected')throw Error('Missing bulk count');if(document.documentElement.scrollWidth>innerWidth)throw Error('Page widened');const bounds=panel.getBoundingClientRect();for(const button of panel.querySelectorAll('button')){const box=button.getBoundingClientRect();if(box.left<bounds.left||box.right>bounds.right)throw Error('Bulk action clipped');}const clear=panel.querySelector('[aria-label="Clear selection"]')?.getBoundingClientRect();if(!clear||clear.left<bounds.left+bounds.width/2)throw Error('Clear selection is not on the right');if(panel.querySelector('.event-rsvp')||document.querySelector('.undo-toast'))throw Error('Single-event controls leaked');const marquee=document.querySelector('.selection-rectangle');if(marquee){const left=Math.min(...rects.map(box=>box.left))-4;const top=Math.min(...rects.map(box=>box.top))-4;const right=Math.max(...rects.map(box=>box.right))+4;const bottom=Math.max(...rects.map(box=>box.bottom))+4;Object.assign(marquee.style,{left:left+'px',top:top+'px',width:(right-left)+'px',height:(bottom-top)+'px'});const box=marquee.getBoundingClientRect();for(const member of rects)if(Math.min(box.right,member.right)<=Math.max(box.left,member.left)||Math.min(box.bottom,member.bottom)<=Math.max(box.top,member.top))throw Error('Marquee misses a selected member');}const notice=document.querySelector('.bulk-notice');if(notice){const box=notice.getBoundingClientRect();if(box.left<0||box.right>innerWidth||box.top<0||box.bottom>innerHeight)throw Error('Bulk result clipped');}document.documentElement.dataset.bulkSelectionProof='pass';document.documentElement.dataset.fixtureReady='true';}));`;
            const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${rendered.html}<script>${proof}</script></body></html>`;
            yield* fs.writeFileString(
              `../../.git/bulk-root-${scenario}-${theme}-${width}-fixture.html`,
              html
            );
          }
        }
      }
    }).pipe(Effect.provide(NodeServices.layer))
);

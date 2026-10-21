import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option, Ref } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { dayFromIso } from "../src/layout/navigation.js";
import { visibleEvents } from "../src/layout/presentation.js";
import {
  executeHeldModProofWithStandInBoxes,
  heldModProofScript,
} from "./held-mod-proof.js";
import {
  heldModRuntimeFixture,
  heldModScenarios,
  heldModTimes,
} from "./held-mod-runtime-fixture.js";

it.effect(
  "exports sixteen actual-root held-modifier results with loaded preconditions and executes the exact embedded scripts with labelled stand-in boxes",
  () =>
    Effect.gen(function* heldModArtifacts() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      for (const scenario of heldModScenarios) {
        const fixture = yield* Effect.gen(function* artifactSource() {
          const h = yield* heldModRuntimeFixture({ scenario });
          const requests = yield* Ref.get(h.api.fake.requests);

          const calendar = h.before.calendar.calendars.find(
            (item) =>
              item.accountId === h.source.accountId &&
              item.calendarId === h.source.calendarId
          );

          return {
            evidence: {
              afterCompanions: visibleEvents(h.model)
                .filter((item) => item.source.eventId !== h.source.eventId)
                .map((item) => ({ key: item.key, source: item.source })),
              afterSelection: h.model.calendar.selected,
              calendar,
              companions: visibleEvents(h.before)
                .filter((item) => item.source.eventId !== h.source.eventId)
                .map((item) => ({ key: item.key, source: item.source })),
              dialogsSeen: h.views.filter((tag) =>
                ["Scope", "Email", "RemoveRecurrence"].includes(tag)
              ),
              expected: heldModTimes[scenario],
              expectedDay: dayFromIso("2026-10-22"),
              loaded: true,
              mutations: requests.filter((request) => request.method !== "GET"),
              native: h.native,
              prepared:
                h.saved === undefined
                  ? undefined
                  : {
                      ...h.saved.plan,
                      session: {
                        ...h.saved.plan.session,
                        master: Option.getOrUndefined(
                          h.saved.plan.session.master
                        ),
                      },
                    },
              readCompleted: Option.isNone(h.model.editing.write),
              requests,
              savedNotice: Option.getOrUndefined(h.model.editing.instantSaved),
              scenario,
              selected: h.before.calendar.selected,
              source: h.source,
            },
            model: h.model,
          };
        }).pipe(Effect.scoped);

        for (const width of [1440, 900]) {
          for (const theme of ["light", "dark"] as const) {
            const sidebar = width <= 1000 ? 185 : 220;
            const panel = width <= 1000 ? 260 : 300;

            const model = {
              ...fixture.model,
              calendar: {
                ...fixture.model.calendar,
                viewport: 844,
                viewportWidth: width - sidebar - panel,
              },
              settings: { ...fixture.model.settings, theme },
            };

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const evidence = JSON.stringify(fixture.evidence).replaceAll(
              "<",
              "\\u003c"
            );

            const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x960"><title>${scenario} ${theme} ${width}</title><style>${css}</style></head><body>${rendered.html}<script type="application/json" id="held-mod-evidence">${evidence}</script><script data-held-mod-proof>${heldModProofScript}</script></body></html>`;
            const path = `../../.git/held-mod-${scenario}-${theme}-${width}-fixture.html`;
            yield* fs.writeFileString(path, html);
            const exported = yield* fs.readFileString(path);

            const document = executeHeldModProofWithStandInBoxes(
              exported,
              width
            );

            expect(document.documentElement.dataset.heldModifierProof).toBe(
              JSON.stringify({ passed: true, scenario })
            );

            const wrong = new DOMParser().parseFromString(
              exported,
              "text/html"
            );

            const precondition = wrong.querySelector("#held-mod-evidence");

            if (precondition === null) {
              throw new Error("Missing exported gesture precondition");
            }

            precondition.textContent = evidence.replace(
              '"loaded":true',
              '"loaded":false'
            );
            expect(() =>
              executeHeldModProofWithStandInBoxes(
                wrong.documentElement.outerHTML,
                width
              )
            ).toThrow("Missing loaded source precondition");
          }
        }
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

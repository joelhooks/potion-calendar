import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import { view } from "../src/features/app.js";
import { printRoute } from "../src/layout/route.js";
import { calendarsRedirectFixture } from "./calendars-redirect-fixture.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

const proof = String.raw`
(() => {
  const requireFact = (ok, message) => { if (!ok) throw Error(message); };
  const evidence = JSON.parse(document.querySelector('#calendars-redirect-evidence').textContent);
  const dialog = document.querySelector('#phone-settings-dialog');
  if (dialog) dialog.showModal();
  requestAnimationFrame(() => {
    requireFact(innerWidth === evidence.width && innerHeight === 900, 'Unexpected redirect fixture viewport');
    requireFact(document.documentElement.scrollWidth <= innerWidth, 'Redirect landing widened viewport');
    requireFact(evidence.route === (evidence.scene === 'general' ? '/settings/general' : '/settings/calendar/work'), 'Redirect result differs from expected landing');
    if (evidence.width === 390) requireFact(dialog && dialog.open && dialog.matches(':modal'), 'Phone settings landing is not a native modal');
    const content = document.querySelector('.settings-content');
    requireFact(content && content.querySelector('h1').textContent === evidence.heading, 'Wrong landing heading');
    requireFact(!content.textContent.includes('Choose which calendars appear here'), 'Standalone overview remains');
    if (evidence.scene === 'reconnect') {
      const warning = [...content.querySelectorAll('[role="alert"]')].find(node => node.textContent.includes('Reconnect this account'));
      requireFact(warning, 'Reconnect warning missing');
      requireFact(content.textContent.includes('Showing calendars saved before this account disconnected. Reconnect to update them.'), 'Cached reconnect explanation missing');
      requireFact(!content.textContent.includes('Calendars for this account appear after you reconnect.'), 'Cached reconnect explanation contradicts visible rows');
      const rows = [...content.querySelectorAll('.settings-calendar-row')];
      requireFact(rows.length === evidence.cachedRows, 'Reconnect cached rows missing');
      requireFact(rows.every(row => row.querySelector('.settings-colour-trigger') && row.querySelector('input[type="checkbox"]')), 'Cached appearance controls missing');
      requireFact(!(warning.compareDocumentPosition(rows[0]) & Node.DOCUMENT_POSITION_PRECEDING), 'Cached rows appear before reconnect warning');
      requireFact(![...content.querySelectorAll('button')].some(node => node.textContent === 'Use as default'), 'Reconnect page enables default choice');
    }
    const active = document.querySelector('.settings-account-nav[aria-current="page"]');
    if (evidence.scene !== 'general') requireFact(active && active.getAttribute('href') === '/settings/calendar/work', 'First account sidebar identity changed');
    document.documentElement.dataset.calendarsRedirectProof = 'pass';
    document.documentElement.dataset.fixtureReady = 'calendars-redirect';
  });
})();
`;

for (const scene of ["account", "general", "reconnect"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [900, 1440, 390]) {
      it.effect(
        `exports P37 ${scene} ${theme} ${width} through the actual redirected root`,
        () =>
          Effect.gen(function* redirectLandingExport() {
            const base = calendarsRedirectFixture(scene, theme);

            const measured = update(
              base,
              Message.MeasuredShellViewport({ width })
            ).model;

            const model = {
              ...measured,
              calendar: {
                ...measured.calendar,
                viewport: 755,
                viewportWidth:
                  width === 390 ? 390 : width - (width <= 1000 ? 445 : 520),
              },
            };

            const route = printRoute(model.route);
            expect(
              route,
              "Fixture must render the redirect result, not the overview"
            ).toBe(
              scene === "general"
                ? "/settings/general"
                : "/settings/calendar/work"
            );
            const fs = yield* FileSystem.FileSystem;
            const css = yield* fs.readFileString("src/client/style.css");

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const evidence = {
              cachedRows: model.calendar.calendars.filter(
                (calendar) => calendar.accountId === "work"
              ).length,
              heading: scene === "general" ? "General" : "owner@example.test",
              route,
              scene,
              theme,
              width,
            };

            const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="fixture-viewport" content="${width}x900"><title>P37 ${scene} ${theme} ${width}</title><style>${css}</style></head><body>${rendered.html}<script type="application/json" id="calendars-redirect-evidence">${JSON.stringify(evidence)}</script><script data-calendars-redirect-proof>${proof}</script></body></html>`;
            const directory = "../../.rat/calendars-redirect/ui";
            yield* fs.makeDirectory(directory, { recursive: true });
            const file = `${directory}/${scene}-${theme}-${width}.html`;
            yield* publishFixtureArtifact(file, html);
            expect(yield* fs.readFileString(file)).toBe(html);
          }).pipe(Effect.provide(NodeServices.layer))
      );
    }
  }
}

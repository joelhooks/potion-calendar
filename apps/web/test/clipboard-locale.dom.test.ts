import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Ref, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { renderToString } from "foldkit/experimental/server";

import { response } from "../../../packages/calendar/test/fake-google.js";
import { ClipboardView } from "../src/client/clipboard/model.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { view } from "../src/features/app.js";
import type { ClipboardLocaleScene } from "./clipboard-locale-fixture.js";
import {
  clipboardLocaleOracle,
  collectClipboardLocale,
} from "./clipboard-locale-fixture.js";
import {
  clipboardLocaleProof,
  executeClipboardLocaleProofWithStandInBoxes,
} from "./clipboard-locale-proof.js";
import { editingRpcFixture, writeBody } from "./editing-rpc-fixture.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

const locales = Schema.Literals(["en-US", "de-DE", "es-LA", "th-TH"]).literals;

const clocks = Schema.Literals(["12", "24"]).literals;

const transitions = Schema.Literals(["gap", "fold"]).literals;

const recipients = Schema.Literals(["single-month", "relative-week"]).literals;

for (const locale of locales) {
  for (const clock of clocks) {
    for (const transition of transitions) {
      for (const recipient of recipients) {
        for (const width of [1440, 390]) {
          it.effect(
            `exports localized ${locale} ${clock} ${transition} ${recipient} refusal at ${width}`,
            () =>
              Effect.gen(function* localeExport() {
                const scene = { clock, locale, recipient, transition, width };
                const artifact = yield* collectClipboardLocale(scene);
                expect(artifact.model.settings.language).toBe(locale);
                expect(
                  artifact.calls,
                  JSON.stringify(artifact.model.clipboard.view)
                ).toHaveLength(recipient === "single-month" ? 0 : 2);
                expect(
                  artifact.calls.every((call) => call.event.title !== "Beta")
                ).toBe(true);

                const rendered = yield* renderToString(
                  { init: () => ({ model: artifact.model }), view },
                  { isHydratable: false }
                );

                const fs = yield* FileSystem.FileSystem;
                const css = yield* fs.readFileString("src/client/style.css");
                const oracle = clipboardLocaleOracle(scene);
                const metadata = { ...scene, timeFormat: clock, ...oracle };
                const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="fixture-viewport" content="${width}x900"><title>Clipboard ${locale} ${clock} ${transition} ${recipient}</title><style>${css}</style></head><body>${rendered.html}<script id="clipboard-locale-evidence" type="application/json">${JSON.stringify(metadata)}</script><script>${clipboardLocaleProof}</script></body></html>`;

                const document = new DOMParser().parseFromString(
                  html,
                  "text/html"
                );

                expect(
                  document.querySelector(
                    recipient === "single-month"
                      ? ".clipboard-toast"
                      : ".clipboard-results"
                  )?.textContent,
                  JSON.stringify(artifact.model.clipboard.view)
                ).toContain(oracle.sentence);
                executeClipboardLocaleProofWithStandInBoxes(document, width);
                expect(
                  document.documentElement.dataset.clipboardLocaleProof
                ).toBe("pass");

                const tampered = new DOMParser().parseFromString(
                  html,
                  "text/html"
                );

                const evidence = tampered.querySelector(
                  "#clipboard-locale-evidence"
                );

                if (evidence === null) {
                  throw new Error("Missing clipboard locale evidence");
                }

                evidence.textContent = JSON.stringify({
                  ...metadata,
                  clock: "wrong clock",
                });
                expect(() => {
                  executeClipboardLocaleProofWithStandInBoxes(tampered, width);
                }).toThrow(
                  "Wrong localized clock/date or English refusal sentence"
                );
                yield* publishFixtureArtifact(
                  `../../.git/clipboard-locale-${locale}-${clock}-${transition}-${recipient}-${width}-fixture.html`,
                  html
                );
              }).pipe(Effect.provide(NodeServices.layer))
          );
        }
      }
    }

    for (const recipient of Schema.Literals(["single-month", "relative-month"])
      .literals) {
      it.effect(
        `changing clipboard diagnostic locale never changes the actual provider-bound instant of a safe month paste: ${locale} ${clock} ${recipient}`,
        () =>
          Effect.gen(function* providerInstant() {
            const hours = recipient === "single-month" ? [10] : [8, 10, 12];

            const fixture = yield* editingRpcFixture(
              hours.flatMap((hour, index) => [
                response(200, {
                  accessRole: "owner",
                  defaultReminders: [],
                  hidden: false,
                  id: "primary",
                  selected: true,
                  summary: "Work",
                  timeZone: "America/Los_Angeles",
                }),
                response(200, {
                  end: { dateTime: `2026-03-09T${hour + 8}:00:00Z` },
                  id: `locale-safe-${index}`,
                  start: { dateTime: `2026-03-09T${hour + 7}:00:00Z` },
                  status: "confirmed",
                  summary: hour === 10 ? "Beta" : "Safe",
                }),
              ])
            );

            const artifact = yield* CalendarEditingClient.use((client) =>
              collectClipboardLocale(
                { clock, locale, recipient, transition: "safe", width: 1440 },
                client
              )
            ).pipe(
              Effect.provide(
                CalendarEditingClient.layer("available").pipe(
                  Layer.provide(FetchHttpClient.layer)
                )
              ),
              Effect.provideService(FetchHttpClient.Fetch, fixture.fetcher)
            );

            const requests = yield* Ref.get(fixture.fake.requests);
            yield* publishFixtureArtifact(
              `../../.git/clipboard-locale-rpc-${locale}-${clock}-${recipient}.json`,
              JSON.stringify(
                { requests, view: artifact.model.clipboard.view },
                null,
                2
              )
            );
            expect(
              requests,
              JSON.stringify(artifact.model.clipboard.view)
            ).toHaveLength(hours.length * 2);

            const writes = requests.filter(
              (request) => request.method === "POST"
            );

            const reminderCalendarReads = requests.filter(
              (request) => request.method === "GET"
            );

            expect(
              reminderCalendarReads.map((request) => request.path)
            ).toEqual(hours.map(() => "/users/me/calendarList/primary"));
            expect(writes).toHaveLength(hours.length);
            expect(
              writes.every((request) =>
                request.path.includes("sendUpdates=none")
              )
            ).toBe(true);

            const beta = writes
              .map((request) => writeBody(request.body ?? "{}"))
              .find((body) => body.summary === "Beta");

            expect(
              beta?.start,
              "changing clipboard diagnostic locale never changes the actual provider-bound instant of a safe month paste"
            ).toEqual({
              dateTime: "2026-03-09T17:00:00.000Z",
              timeZone: "America/Los_Angeles",
            });
            expect(beta?.end).toEqual({
              dateTime: "2026-03-09T18:00:00.000Z",
              timeZone: "America/Los_Angeles",
            });
          }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
      );
    }
  }
}

const refusalBoundaries = transitions.flatMap((transition) =>
  Schema.Literals(["start", "end"]).literals.flatMap((endpoint) =>
    Schema.Literals([
      "single-month",
      "relative-month",
      "relative-week",
    ]).literals.map((recipient): ClipboardLocaleScene => ({
      clock: "24",
      endpoint,
      locale: "es-LA",
      recipient,
      transition,
      width: 390,
    }))
  )
);

const focusedScenes: readonly ClipboardLocaleScene[] = [
  ...refusalBoundaries,
  {
    browserDefault: true,
    browserLocale: "es-LA",
    clock: "system",
    locale: "en-US",
    recipient: "single-month",
    system24Hour: true,
    transition: "gap",
    width: 390,
  },
  {
    browserDefault: true,
    browserLocale: "de-DE",
    clock: "system",
    locale: "en-US",
    recipient: "relative-week",
    system24Hour: false,
    transition: "fold",
    width: 1440,
  },
  {
    browserLocale: "ja-JP",
    clock: "system",
    copyLocale: "en-US",
    locale: "de-DE",
    personId: "locale-person-A",
    recipient: "relative-month",
    system24Hour: true,
    transition: "gap",
    width: 390,
  },
  {
    browserLocale: "ja-JP",
    clock: "12",
    copyLocale: "de-DE",
    locale: "es-LA",
    personId: "locale-person-B",
    recipient: "single-month",
    transition: "fold",
    width: 390,
  },
  {
    clock: "12",
    confirmationLocale: "en-US",
    locale: "de-DE",
    recipient: "relative-week",
    transition: "gap",
    width: 390,
  },
];

for (const [index, scene] of focusedScenes.entries()) {
  it.effect(
    `refusal boundary ${index + 1}: ${scene.locale} ${scene.clock} ${scene.transition} ${scene.recipient} ${scene.endpoint ?? "start"}`,
    () =>
      Effect.gen(function* refusalRecipientBoundary() {
        const artifact = yield* collectClipboardLocale(scene);
        const current = artifact.model.clipboard.view;

        if (
          scene.transition === "gap" &&
          scene.endpoint === "end" &&
          scene.recipient === "relative-week"
        ) {
          expect(artifact.calls).toHaveLength(3);

          const beta = artifact.calls.find(
            (call) => call.event.title === "Beta"
          );

          expect(beta?.event.start).toMatchObject({
            dateTime: "2026-03-08T09:30:00.000Z",
          });
          expect(beta?.event.end).toMatchObject({
            dateTime: "2026-03-08T10:30:00.000Z",
          });
          expect(
            ClipboardView.guards.Results(current) && current.issues.length === 0
          ).toBe(true);

          return;
        }

        const text = ClipboardView.guards.Results(current)
          ? current.issues.map((issue) => issue.reason).join("\n")
          : Option.getOrElse(current.toast, () => ({ id: "", message: "" }))
              .message;

        expect(text).toContain(clipboardLocaleOracle(scene).sentence);
        expect(artifact.calls).toHaveLength(
          scene.recipient === "single-month" ? 0 : 2
        );
        expect(
          artifact.calls.every((call) => call.event.title !== "Beta")
        ).toBe(true);
        expect(Option.getOrThrow(current.copied).personId).toBe(
          scene.personId ?? "fixture-person"
        );

        if (scene.confirmationLocale === undefined) {
          expect(artifact.model.settings.language).toBe(
            scene.browserDefault === true ? undefined : scene.locale
          );
        } else {
          expect(artifact.confirmed).toBe(true);
          expect(artifact.model.settings.language).toBe(
            scene.confirmationLocale
          );
          expect(artifact.model.settings.timeFormat).toBe("24");
          expect(artifact.presentation).toEqual({
            locale: "de-DE",
            timeFormat: "12",
          });
        }
      }).pipe(Effect.provide(NodeServices.layer))
  );
}

for (const locale of locales) {
  it.effect(
    `all-day clipboard dates remain canonical with ${locale} presentation`,
    () =>
      Effect.gen(function* allDayRecipient() {
        const artifact = yield* collectClipboardLocale({
          allDay: true,
          clock: "24",
          locale,
          recipient: "single-month",
          transition: "safe",
          width: 390,
        });

        expect(artifact.calls).toHaveLength(1);
        expect(artifact.calls[0]?.event.start).toEqual({ date: "2026-03-09" });
        expect(artifact.calls[0]?.event.end).toEqual({ date: "2026-03-10" });
        expect(
          Option.getOrThrow(artifact.model.clipboard.view.toast).message
        ).toBe("Pasted event.");
      }).pipe(Effect.provide(NodeServices.layer))
  );
}

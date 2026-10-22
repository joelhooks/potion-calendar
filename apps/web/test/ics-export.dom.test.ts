import { Blob as NodeBlob } from "node:buffer";

import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";
import type { HtmlBuilder } from "foldkit/html";
import { Scene } from "foldkit/test";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { DownloadSelectedIcs } from "../src/client/ics-export/browser.js";
import {
  IcsSelection,
  selectedIcsEvents,
} from "../src/client/ics-export/selection.js";
import { view as appView } from "../src/features/app.js";
import { commandMenu } from "../src/features/command-menu.js";
import { icsExportFixture } from "./ics-export-fixture.js";

const view = (model: AppModel, h: HtmlBuilder<AppMessage>) =>
  h.div([], commandMenu(model, h));

it.effect(
  "the actual command catalog dispatches one selected ICS download",
  () =>
    Effect.sync(() => {
      const base = icsExportFixture(true);

      const opened = update(
        base,
        Message.KeyboardAction({ id: "commands" })
      ).model;

      const personId = Option.getOrThrow(opened.person);

      Scene.scene(
        { update, view },
        Scene.given(opened),
        Scene.click(Scene.role("option", { name: "Export as .ics" })),
        Scene.Command.expectHas(DownloadSelectedIcs),
        Scene.Command.resolve(
          DownloadSelectedIcs,
          Message.ReceivedIcsExport({
            notice: { message: "Download started.", personId, revision: 1 },
          })
        )
      );
    })
);

it.effect(
  "the isolated actual catalog DOM omits ICS with no selection or desktop availability",
  () =>
    Effect.gen(function* unavailableCatalog() {
      const base = icsExportFixture();

      const opened = update(
        base,
        Message.KeyboardAction({ id: "commands" })
      ).model;

      for (const model of [
        { ...opened, calendar: { ...opened.calendar, selected: [] } },
        {
          ...opened,
          desktop: { ...opened.desktop, availability: "available" as const },
        },
      ]) {
        const rendered = yield* renderToString(
          { init: () => ({ model }), view: appView },
          { isHydratable: false }
        );

        const document = new DOMParser().parseFromString(
          rendered.html,
          "text/html"
        );

        expect(document.querySelector("#command-export-ics")).toBeNull();
        expect(
          document.querySelector("#keyboard-command-dialog")
        ).not.toBeNull();
      }
    })
);

it.effect(
  "the named browser export builds one calendar Blob, dispatches the anchor and cleans up its URL without network calls",
  () =>
    Effect.gen(function* localDownload() {
      const model = icsExportFixture(true);
      const selection = selectedIcsEvents(model);
      expect(IcsSelection.guards.Ready(selection)).toBe(true);

      if (!IcsSelection.guards.Ready(selection)) {
        return;
      }

      const blobs: Blob[] = [];
      const revoked: string[] = [];

      const clicks: { download: string; href: string; connected: boolean }[] =
        [];

      const OriginalUrl = URL;

      const spies = yield* Effect.acquireRelease(
        Effect.sync(() => {
          class LocalUrl extends OriginalUrl {
            static override createObjectURL(blob: Blob): string {
              blobs.push(blob);

              return "blob:ics-test";
            }
            static override revokeObjectURL(href: string): void {
              revoked.push(href);
            }
          }

          vi.stubGlobal("URL", LocalUrl);
          vi.stubGlobal("Blob", NodeBlob);

          const click = vi
            .spyOn(HTMLAnchorElement.prototype, "click")
            .mockImplementation(function clickAnchor(this: HTMLAnchorElement) {
              clicks.push({
                connected: this.isConnected,
                download: this.download,
                href: this.href,
              });
            });

          const network = vi
            .spyOn(globalThis, "fetch")
            .mockImplementation(() => {
              throw new Error("ICS export must not use the network");
            });

          return { click, network };
        }),
        (ownedSpies) =>
          Effect.sync(() => {
            ownedSpies.click.mockRestore();
            ownedSpies.network.mockRestore();
            vi.unstubAllGlobals();
          })
      );

      const result = yield* DownloadSelectedIcs({
        events: selection.events,
        personId: selection.personId,
        revision: 1,
      }).effect;

      expect(result).toMatchObject({
        notice: {
          message: "Download started.",
          personId: selection.personId,
          revision: 1,
        },
      });
      expect(blobs).toHaveLength(1);
      const [blob] = blobs;
      expect(blob?.type).toBe("text/calendar;charset=utf-8");

      const exportedBlob = Option.getOrThrow(Option.fromUndefinedOr(blob));
      const text = yield* Effect.promise(exportedBlob.text.bind(exportedBlob));

      expect(text.match(/BEGIN:VCALENDAR/gu)).toHaveLength(1);
      expect(text.match(/BEGIN:VEVENT/gu)).toHaveLength(2);
      expect(text).toContain("SUMMARY:Planning export");
      expect(text).toContain("SUMMARY:Project review");
      expect(clicks).toEqual([
        { connected: true, download: "events.ics", href: "blob:ics-test" },
      ]);
      expect(revoked).toEqual(["blob:ics-test"]);
      expect(document.querySelector('a[download="events.ics"]')).toBeNull();

      const [first] = selection.events;

      const single = yield* DownloadSelectedIcs({
        events: [first],
        personId: selection.personId,
        revision: 2,
      }).effect;

      expect(single).toMatchObject({
        notice: { message: "Download started." },
      });
      expect(clicks[1]?.download).toBe("planning-export.ics");

      const master = {
        ...first,
        end: {
          dateTime: "2026-03-01T10:00:00-08:00",
          timeZone: "America/Los_Angeles",
        },
        eventId: "zoned-master",
        recurrence: ["RRULE:FREQ=WEEKLY"],
        start: {
          dateTime: "2026-03-01T09:00:00-08:00",
          timeZone: "America/Los_Angeles",
        },
      };

      const partial = yield* DownloadSelectedIcs({
        events: [first, master],
        personId: selection.personId,
        revision: 3,
      }).effect;

      expect(partial).toMatchObject({
        notice: {
          message:
            "Download started. Skipped 1 repeating series in a time zone. Select one occurrence to export it.",
        },
      });

      const partialBlob = Option.getOrThrow(
        Option.fromUndefinedOr(blobs.at(2))
      );

      const partialText = yield* Effect.promise(
        partialBlob.text.bind(partialBlob)
      );

      expect(partialText.match(/BEGIN:VEVENT/gu)).toHaveLength(1);

      const refused = yield* DownloadSelectedIcs({
        events: [master],
        personId: selection.personId,
        revision: 4,
      }).effect;

      expect(refused).toMatchObject({
        notice: {
          message:
            "Repeating series in a time zone can't be exported yet. Select one occurrence to export it.",
        },
      });
      expect(blobs).toHaveLength(3);
      expect(clicks).toHaveLength(3);
      expect(revoked).toHaveLength(3);

      spies.click.mockImplementation(() => {
        throw new Error("Fake blocked download");
      });

      const blocked = yield* DownloadSelectedIcs({
        events: [first],
        personId: selection.personId,
        revision: 5,
      }).effect;

      expect(blocked).toMatchObject({
        notice: {
          message: "The download couldn't be started. Try exporting again.",
        },
      });
      expect(blobs).toHaveLength(4);
      expect(revoked).toHaveLength(4);
      expect(document.querySelector("a[download]")).toBeNull();
      expect(spies.network).not.toHaveBeenCalled();
    }).pipe(Effect.scoped)
);

it.effect(
  "a stand-in desktop bridge hides the entry and refuses a directly invoked download without weakening native policy",
  () =>
    Effect.gen(function* desktopExportBoundary() {
      const previous = Object.getOwnPropertyDescriptor(window, "potionDesktop");
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          Object.defineProperty(window, "potionDesktop", {
            configurable: true,
            value: {},
          });
        }),
        () =>
          Effect.sync(() => {
            if (previous === undefined) {
              Reflect.deleteProperty(window, "potionDesktop");
            } else {
              Object.defineProperty(window, "potionDesktop", previous);
            }
          })
      );
      const base = icsExportFixture();

      const model = {
        ...base,
        desktop: { ...base.desktop, availability: "available" as const },
      };

      const opened = update(
        model,
        Message.KeyboardAction({ id: "commands" })
      ).model;

      Scene.scene(
        { update, view },
        Scene.given(opened),
        Scene.expect(
          Scene.role("option", { name: "Export as .ics" })
        ).toBeAbsent()
      );
      const source = selectedIcsEvents(base);

      if (IcsSelection.guards.Ready(source)) {
        const result = yield* DownloadSelectedIcs({
          events: source.events,
          personId: source.personId,
          revision: 1,
        }).effect;

        expect(result).toMatchObject({
          notice: {
            message:
              "ICS export is available in your browser, not the desktop app.",
          },
        });
      } else {
        expect.fail("Expected the browser fixture selection to be ready");
      }
    }).pipe(Effect.scoped)
);

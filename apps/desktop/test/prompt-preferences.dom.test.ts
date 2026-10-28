// @effect-diagnostics-next-line nodeBuiltinImport:off -- Actual renderer fixtures export bounded local HTML without a browser or a second runtime.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { PromptView, promptWire } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Schema } from "effect";
import { vi } from "vitest";

import {
  attachmentButton,
  mountAttachmentPrompt,
} from "./prompt-attachment-fixture.js";
import {
  promptMeeting,
  promptPreferences,
} from "./prompt-preferences-fixture.js";

const renderedTime = (instant: number, hourCycle: "h12" | "h23") =>
  DateTime.formatLocal(DateTime.makeUnsafe(instant), {
    hour: "numeric",
    hourCycle,
    minute: "2-digit",
  });

for (const theme of ["light", "dark"] as const) {
  for (const timeFormat of ["12", "24"] as const) {
    for (const set of [false, true]) {
      it.effect(
        `actual prompt renderer exports ${theme} ${timeFormat} hint ${set ? "set" : "unset"}`,
        () =>
          Effect.gen(function* preferenceScene() {
            const platform = vi
              .spyOn(navigator, "platform", "get")
              .mockReturnValue("MacIntel");

            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                platform.mockRestore();
                document.documentElement.style.removeProperty("color-scheme");
              })
            );

            const { present, calls } = yield* mountAttachmentPrompt([
              promptMeeting,
            ]);

            const preferences = {
              ...promptPreferences,
              joinShortcut: set ? "Control+Command+J" : null,
              theme,
              timeFormat,
            };

            present({ events: [promptMeeting], preferences, revision: 2 });
            expect(document.documentElement.style.colorScheme).toBe(theme);
            expect(document.querySelector("p")?.textContent).toBe(
              renderedTime(
                promptMeeting.start,
                timeFormat === "12" ? "h12" : "h23"
              )
            );
            expect(
              document.querySelector("[data-prompt-join-hint]")?.textContent
            ).toBe(set ? "Global join ⌃⌘J" : undefined);
            expect(
              document.querySelectorAll("[data-prompt-join-hint]")
            ).toHaveLength(set ? 1 : 0);
            const css = readFileSync("src/client/prompt.css", "utf-8");
            const directory = "../../.rat/prompt-prefs/ui";
            mkdirSync(directory, { recursive: true });
            const html = `<!doctype html><html lang="en" style="color-scheme: ${theme};"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>P49 ${theme} ${timeFormat} ${set}</title><style>${css}</style></head><body>${document.body.innerHTML}</body></html>`;
            writeFileSync(
              `${directory}/${theme}-${timeFormat}-${set ? "set" : "unset"}.html`,
              html
            );
            attachmentButton("[data-prompt-join]").click();
            expect(calls).toEqual([{ action: "join", key: promptMeeting.key }]);
            present({ events: [promptMeeting], revision: 3 });
            expect(document.documentElement.style.colorScheme).toBe("");
            expect(
              document.querySelector("[data-prompt-join-hint]")
            ).toBeNull();
          }).pipe(Effect.scoped)
      );
    }
  }
}

it.effect(
  "multiple cards have one inert global hint, distinct Join targets and no hint or theme retained after invalid or legacy input",
  () =>
    Effect.gen(function* multipleRecipients() {
      const platform = vi
        .spyOn(navigator, "platform", "get")
        .mockReturnValue("Linux x86_64");

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          platform.mockRestore();
          document.documentElement.style.removeProperty("color-scheme");
        })
      );

      const second = {
        ...promptMeeting,
        key: { ...promptMeeting.key, eventId: "two" },
        title:
          "Second meeting with a long wrapping title and a global hint that never selects this event",
      };

      const { present, calls } = yield* mountAttachmentPrompt([
        promptMeeting,
        second,
      ]);

      const view = {
        events: [promptMeeting, second],
        preferences: promptPreferences,
        revision: 2,
      };

      const encoded = yield* Schema.encodeEffect(promptWire.view)(view);
      present(yield* Schema.decodeEffect(promptWire.view)(encoded));
      const hints = document.querySelectorAll("[data-prompt-join-hint]");
      expect(hints).toHaveLength(1);
      expect(hints[0]?.textContent).toBe("Global join Ctrl+Command+J");
      expect(hints[0]?.tagName).toBe("SPAN");
      expect(hints[0]?.getAttribute("tabindex")).toBeNull();
      expect(document.querySelectorAll("[data-prompt-menu]")).toHaveLength(2);
      expect(document.querySelectorAll("[data-prompt-dismiss]")).toHaveLength(
        2
      );
      const css = readFileSync("src/client/prompt.css", "utf-8");
      mkdirSync("../../.rat/prompt-prefs/ui", {
        recursive: true,
      });
      writeFileSync(
        "../../.rat/prompt-prefs/ui/multi-meeting.html",
        `<!doctype html><html style="color-scheme: dark;"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>P49 multiple meetings</title><style>${css}</style></head><body>${document.body.innerHTML}</body></html>`
      );
      attachmentButton('[data-event-id="two"] [data-prompt-join]').click();
      attachmentButton('[data-event-id="one"] [data-prompt-join]').click();
      expect(calls).toEqual([
        { action: "join", key: second.key },
        { action: "join", key: promptMeeting.key },
      ]);
      present(
        yield* Schema.decodeUnknownEffect(PromptView)({
          ...view,
          preferences: { ...promptPreferences, version: 2 },
          revision: 3,
        })
      );
      expect(document.querySelector("[data-prompt-join-hint]")).toBeNull();
      expect(document.documentElement.style.colorScheme).toBe("");
      expect(document.querySelectorAll("article")).toHaveLength(2);
      expect(calls).toHaveLength(2);
    }).pipe(Effect.scoped)
);

it.effect(
  "explicit time cycles render midnight noon and afternoon without changing the local instant",
  () =>
    Effect.gen(function* exactHourCycles() {
      const { present } = yield* mountAttachmentPrompt([promptMeeting]);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          document.documentElement.style.removeProperty("color-scheme");
        })
      );

      for (const instant of [0, 43_200_000, 54_300_000]) {
        for (const timeFormat of ["12", "24"] as const) {
          const event = {
            ...promptMeeting,
            end: instant + 60_000,
            start: instant,
          };

          present({
            events: [event],
            preferences: { ...promptPreferences, timeFormat },
            revision: 2,
          });
          const actual = document.querySelector("p")?.textContent;
          expect(actual).toBe(
            renderedTime(instant, timeFormat === "12" ? "h12" : "h23")
          );

          if (timeFormat === "24") {
            expect(actual).not.toMatch(/^24:/u);
          }
        }
      }
    }).pipe(Effect.scoped)
);

it.effect(
  "actual prompt locale timing preserves English actions, clock choice and legacy fallback",
  () =>
    Effect.gen(function* localePromptRecipients() {
      const { present, calls } = yield* mountAttachmentPrompt([promptMeeting]);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          document.documentElement.style.removeProperty("color-scheme");
        })
      );
      let revision = 1;

      for (const locale of [
        "fr-FR",
        "ja-JP",
        "es-419",
        "th-TH-u-ca-buddhist",
        undefined,
        "",
        "en_US",
        null,
      ]) {
        for (const timeFormat of ["12", "24"] as const) {
          for (const instant of [
            0,
            43_200_000,
            54_300_000,
            DateTime.toEpochMillis(DateTime.makeUnsafe("2026-03-08T10:01:00Z")),
          ]) {
            const event = {
              ...promptMeeting,
              end: instant + 60_000,
              start: instant,
            };

            revision += 1;

            const view = yield* Schema.decodeUnknownEffect(PromptView)({
              events: [event],
              preferences: { ...promptPreferences, locale, timeFormat },
              revision,
            });

            const encoded = yield* Schema.encodeEffect(promptWire.view)(view);
            present(yield* Schema.decodeEffect(promptWire.view)(encoded));
            const acceptedLocale = view.preferences?.locale;

            const options: Intl.DateTimeFormatOptions = {
              hour: "numeric",
              hourCycle: timeFormat === "12" ? "h12" : "h23",
              minute: "2-digit",
            };

            if (acceptedLocale !== undefined) {
              options.calendar = "gregory";
            }

            expect(document.querySelector("p")?.textContent).toBe(
              new Intl.DateTimeFormat(acceptedLocale, options).format(instant)
            );
            expect(document.querySelector("h2")?.textContent).toBe(
              promptMeeting.title
            );
            expect(attachmentButton("[data-prompt-join]").textContent).toBe(
              "Join"
            );
            expect(view.events[0]?.start).toBe(instant);
            expect(view.events[0]?.end).toBe(instant + 60_000);
            expect(view.preferences?.timeFormat).toBe(timeFormat);
          }
        }
      }

      expect(calls).toEqual([]);
    }).pipe(Effect.scoped)
);

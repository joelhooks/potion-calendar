import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { AsyncData } from "foldkit";
import type { HtmlBuilder } from "foldkit/html";
import { Scene } from "foldkit/test";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { ReadEvents, ScrollToSelection } from "../src/client/commands.js";
import { OpenProviderOriginal } from "../src/client/keyboard/browser.js";
import { commandMenu } from "../src/features/command-menu.js";
import {
  providerOriginalHref,
  selectedReadFixture,
} from "./selected-event-read-fixture.js";
import {
  executeSelectedEventReadProofWithStandIns,
  selectedEventReadProofScript,
} from "./selected-event-read-proof.js";

it.effect.prop(
  "fixture modal checks refuse closed and nonmodal dialogs before trusting geometry",
  { presentation: Schema.Literals(["closed", "nonmodal"]) },
  ({ presentation }) =>
    Effect.sync(() => {
      const html = `<dialog id="keyboard-command-dialog"></dialog><script type="application/json" id="selected-read-evidence">{}</script><script data-selected-read-proof>${selectedEventReadProofScript}</script>`;
      expect(() =>
        executeSelectedEventReadProofWithStandIns(html, 900, presentation)
      ).toThrow("Command dialog is not modal");
    })
);

const view = (model: AppModel, h: HtmlBuilder<AppMessage>) =>
  h.div([], commandMenu(model, h));

it.effect(
  "native catalog choices reach the protected provider command and existing date-read path",
  () =>
    Effect.sync(() => {
      const opened = update(
        selectedReadFixture("selected"),
        Message.KeyboardAction({ id: "commands" })
      ).model;

      Scene.scene(
        { update, view },
        Scene.given(opened),
        Scene.click(Scene.role("option", { name: "Open in Google Calendar" })),
        Scene.Command.expectHas(OpenProviderOriginal),
        Scene.Command.resolve(OpenProviderOriginal, Message.Navigated())
      );

      const work = Option.getOrThrow(
        AsyncData.getData(
          Option.getOrThrow(Option.fromUndefinedOr(opened.calendar.reads[0]))
            .events
        )
      );

      Scene.scene(
        { update, view },
        Scene.given(opened),
        Scene.click(Scene.role("option", { name: "Go to selection" })),
        Scene.Command.expectHas(ReadEvents),
        Scene.Command.resolveAll(
          [
            ReadEvents,
            Message.ReceivedEvents({
              accountId: "work",
              request: opened.calendar.rangeRequest + 1,
              result: work,
            }),
          ],
          [
            ReadEvents,
            Message.ReceivedEvents({
              accountId: "personal",
              request: opened.calendar.rangeRequest + 1,
              result: { events: [], versions: [] },
            }),
          ],
          [ScrollToSelection, Message.CompletedGridScroll()]
        )
      );
    })
);

it.effect.prop(
  "the provider command refuses unsafe schemes even when callers bypass catalog validation",
  {
    payload: Schema.String,
    scheme: Schema.Literals([
      "javascript",
      "data",
      "file",
      "vbscript",
      "mailto",
      "ftp",
    ]),
  },
  ({ scheme, payload }) =>
    Effect.gen(function* refuseUnsafeBoundary() {
      const opener = yield* Effect.acquireRelease(
        Effect.sync(() => vi.spyOn(window, "open").mockReturnValue(null)),
        (spy) =>
          Effect.sync(() => {
            spy.mockRestore();
          })
      );

      yield* OpenProviderOriginal({ href: `${scheme}:${payload}` }).effect;
      expect(opener).not.toHaveBeenCalled();
    }).pipe(Effect.scoped)
);

it.effect(
  "the provider command uses a protected new tab for safe HTTP(S) and refuses credential or parser-confusable URLs",
  () =>
    Effect.gen(function* providerBoundary() {
      const opener = yield* Effect.acquireRelease(
        Effect.sync(() => vi.spyOn(window, "open").mockReturnValue(null)),
        (spy) =>
          Effect.sync(() => {
            spy.mockRestore();
          })
      );

      for (const href of [
        "https://user:secret@example.test/event",
        "https://calendar.google.com/\nevent",
        " https://calendar.google.com/event",
        "https:\\calendar.google.com/event",
        "mailto:owner@example.test",
      ]) {
        yield* OpenProviderOriginal({ href }).effect;
      }

      expect(opener).not.toHaveBeenCalled();

      yield* OpenProviderOriginal({ href: providerOriginalHref }).effect;
      yield* OpenProviderOriginal({
        href: "http://provider.example.test/event",
      }).effect;
      expect(opener.mock.calls).toEqual([
        [providerOriginalHref, "_blank", "noopener,noreferrer"],
        ["http://provider.example.test/event", "_blank", "noopener,noreferrer"],
      ]);
    }).pipe(Effect.scoped)
);

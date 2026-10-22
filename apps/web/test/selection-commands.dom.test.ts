import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Option, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";
import type { HtmlBuilder } from "foldkit/html";
import { Scene } from "foldkit/test";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import {
  ScrollSelectionArgs,
  ScrollToSelection,
} from "../src/client/commands.js";
import { OpenProviderOriginal } from "../src/client/keyboard/browser.js";
import {
  OccurrenceNotice,
  OccurrenceProblem,
} from "../src/client/selection-commands/model.js";
import { view as fullView } from "../src/features/app.js";
import { commandMenu } from "../src/features/command-menu.js";
import { selectionCommandStatus } from "../src/features/selection-command-status.js";
import {
  beginCommandOccurrence,
  selectionCommandFixture,
} from "./selection-command-fixture.js";

const view = (model: AppModel, h: HtmlBuilder<AppMessage>) =>
  h.div([], [...commandMenu(model, h), ...selectionCommandStatus(model, h)]);

it.effect.prop(
  "native occurrence catalog clicks reach the real root and show absence as status rather than error",
  {
    direction: Schema.Literals(["next", "previous"]),
  },
  ({ direction }) =>
    Effect.sync(() => {
      const { model } = selectionCommandFixture();
      const { task } = beginCommandOccurrence(model, direction);

      const opened = update(
        model,
        Message.KeyboardAction({ id: "commands" })
      ).model;

      Scene.scene(
        { update, view },
        Scene.given(opened),
        Scene.click(
          Scene.role("option", {
            name:
              direction === "next" ? "Next occurrence" : "Previous occurrence",
          })
        ),
        Scene.expect(Scene.role("status")).toHaveText(
          `Finding ${direction} occurrence…`
        ),
        Scene.Subscription.emit(
          Message.ReceivedOccurrence({
            notice: OccurrenceNotice.cases.Ready.make({ event: null, task }),
          })
        ),
        Scene.expect(Scene.role("status")).toHaveText(
          direction === "next" ? "No later occurrence" : "No earlier occurrence"
        ),
        Scene.expect(Scene.role("alert")).not.toExist(),
        Scene.Command.expectNone()
      );
    })
);

it.effect(
  "native occurrence failure is an alert, not the empty status, and a late result does not replace it",
  () =>
    Effect.sync(() => {
      const { model } = selectionCommandFixture();
      const { task } = beginCommandOccurrence(model, "next");

      const opened = update(
        model,
        Message.KeyboardAction({ id: "commands" })
      ).model;

      Scene.scene(
        { update, view },
        Scene.given(opened),
        Scene.click(Scene.role("option", { name: "Next occurrence" })),
        Scene.Subscription.emit(
          Message.ReceivedOccurrence({
            notice: OccurrenceNotice.cases.Failed.make({
              problem: OccurrenceProblem.cases.Transport.make({}),
              task,
            }),
          })
        ),
        Scene.expect(Scene.role("alert")).toHaveText(
          "Couldn't find the next occurrence"
        ),
        Scene.expect(Scene.role("status")).not.toExist(),
        Scene.Subscription.emit(
          Message.ReceivedOccurrence({
            notice: OccurrenceNotice.cases.Ready.make({ event: null, task }),
          })
        ),
        Scene.expect(Scene.role("alert")).toHaveText(
          "Couldn't find the next occurrence"
        ),
        Scene.Command.expectNone()
      );
    })
);

it.effect(
  "the Google command label reaches the same protected external-open command through the root",
  () =>
    Effect.sync(() => {
      const { model } = selectionCommandFixture(false);

      const opened = update(
        model,
        Message.KeyboardAction({ id: "commands" })
      ).model;

      Scene.scene(
        { update, view },
        Scene.given(opened),
        Scene.expect(
          Scene.role("option", { name: "Next occurrence" })
        ).not.toExist(),
        Scene.click(Scene.role("option", { name: "Open in Google Calendar" })),
        Scene.Command.expectHas(OpenProviderOriginal),
        Scene.Command.resolve(OpenProviderOriginal, Message.Navigated())
      );
    })
);

it.effect(
  "the root's actual scroll command waits for render commit, targets the selected chip and ignores a stale deselection",
  () =>
    Effect.gen(function* nativeSelectionScroll() {
      const { model } = selectionCommandFixture();

      const opened = update(
        model,
        Message.KeyboardAction({ id: "commands" })
      ).model;

      const result = update(
        opened,
        Message.KeyboardPick({ id: "go-to-selection" })
      );

      const queued = Option.getOrThrow(
        Option.fromUndefinedOr(
          result.commands?.find(
            (command) => command.name === "ScrollToSelection"
          )
        )
      );

      const args = yield* Schema.decodeUnknownEffect(ScrollSelectionArgs)(
        queued.args
      );

      const rendered = yield* renderToString(
        { init: () => ({ model: result.model }), view: fullView },
        { isHydratable: false }
      );

      const root = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const element = document.createElement("div");
          element.innerHTML = rendered.html;
          document.body.append(element);

          return element;
        }),
        (element) =>
          Effect.sync(() => {
            element.remove();
          })
      );

      const viewport = root.querySelector<HTMLElement>("#time-viewport");

      const target = [
        ...root.querySelectorAll<HTMLElement>("[data-event-key]"),
      ].find(
        (element) =>
          element.dataset.eventKey === args.key &&
          element.classList.contains("selected")
      );

      if (viewport === null || target === undefined) {
        return yield* Effect.die(
          "Missing actual time viewport or selected event"
        );
      }

      Object.defineProperty(viewport, "clientHeight", { value: 400 });
      Object.defineProperty(viewport, "getBoundingClientRect", {
        value: () => new DOMRect(0, 0, 500, 400),
      });
      Object.defineProperty(target, "getBoundingClientRect", {
        value: () => new DOMRect(800, 100, 100, 40),
      });
      const frame = yield* Deferred.make<FrameRequestCallback>();

      const raf = yield* Effect.acquireRelease(
        Effect.sync(() =>
          vi
            .spyOn(globalThis, "requestAnimationFrame")
            .mockImplementation((onAnimationFrame) => {
              Deferred.doneUnsafe(frame, Effect.succeed(onAnimationFrame));

              return 1;
            })
        ),
        (spy) =>
          Effect.sync(() => {
            spy.mockRestore();
          })
      );

      const scrolling = yield* Effect.forkChild(ScrollToSelection(args).effect);
      const commit = yield* Deferred.await(frame);
      expect(viewport.scrollTop).toBe(0);
      commit(0);
      yield* Fiber.join(scrolling);
      expect(viewport.scrollTop).toBeGreaterThan(0);
      expect(viewport.scrollLeft).toBe(400);
      expect(raf).toHaveBeenCalledTimes(1);
      target.classList.remove("selected");
      viewport.scrollTop = 0;
      viewport.scrollLeft = 0;
      const secondFrame = yield* Deferred.make<FrameRequestCallback>();
      raf.mockImplementation((onAnimationFrame) => {
        Deferred.doneUnsafe(secondFrame, Effect.succeed(onAnimationFrame));

        return 2;
      });
      const second = yield* Effect.forkChild(ScrollToSelection(args).effect);
      const secondCommit = yield* Deferred.await(secondFrame);
      secondCommit(0);
      yield* Fiber.join(second);
      expect(viewport.scrollTop).toBe(0);
      expect(viewport.scrollLeft).toBe(0);

      return yield* Effect.void;
    })
);

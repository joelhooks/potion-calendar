import { expect, it } from "@effect/vitest";
import { Effect, Option, Queue, Schema, Stream } from "effect";
import { vi } from "vitest";

import type { AppMessage } from "../src/client/message.js";
import { searchInteractions } from "../src/client/search/browser.js";

it.effect(
  "the mounted capture listener requests older results exactly within one viewport of the top",
  () =>
    Effect.gen(function* nearTopSearch() {
      const viewport = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const element = document.createElement("div");
          element.id = "search-results";
          document.body.append(element);

          return element;
        }),
        (element) =>
          Effect.sync(() => {
            element.remove();
          })
      );

      let top = 601;
      let height = 600;

      Object.defineProperties(viewport, {
        clientHeight: { configurable: true, get: () => height },
        scrollHeight: { configurable: true, get: () => 5000 },
        scrollTop: { configurable: true, get: () => top },
      });
      const registered = yield* Queue.unbounded<true>();
      const arrived = yield* Queue.unbounded<AppMessage>();
      const add = document.addEventListener.bind(document);

      const spy = vi
        .spyOn(document, "addEventListener")
        .mockImplementation((type, listener, options) => {
          add(type, listener, options);

          if (
            type === "scroll" &&
            Schema.is(Schema.Struct({ capture: Schema.Literal(true) }))(options)
          ) {
            Queue.offerUnsafe(registered, true);
          }
        });

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          spy.mockRestore();
        })
      );
      yield* searchInteractions().pipe(
        Stream.runForEach((message) => Queue.offer(arrived, message)),
        Effect.forkScoped
      );
      yield* Queue.take(registered);
      viewport.dispatchEvent(new Event("scroll"));
      yield* Effect.yieldNow;
      expect(yield* Queue.poll(arrived)).toEqual(Option.none());
      top = 600;
      viewport.dispatchEvent(new Event("scroll"));
      yield* Effect.yieldNow;
      const received = yield* Queue.poll(arrived);
      expect(received.pipe(Option.map((message) => message._tag))).toEqual(
        Option.some("SearchOlder")
      );
      viewport.dataset.searchRestoredPosition = String(top);
      viewport.dispatchEvent(new Event("scroll"));
      yield* Effect.yieldNow;
      expect(yield* Queue.poll(arrived)).toEqual(Option.none());
      top = 599;
      viewport.dispatchEvent(new Event("scroll"));
      yield* Effect.yieldNow;
      const next = yield* Queue.poll(arrived);
      expect(next.pipe(Option.map((message) => message._tag))).toEqual(
        Option.some("SearchOlder")
      );
      height = 0;
      top = 0;
      viewport.dispatchEvent(new Event("scroll"));
      yield* Effect.yieldNow;
      expect(yield* Queue.poll(arrived)).toEqual(Option.none());
    }).pipe(Effect.scoped)
);

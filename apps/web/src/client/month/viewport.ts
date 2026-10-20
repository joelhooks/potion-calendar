import { Effect, Queue, Stream } from "effect";
import { Mount } from "foldkit";

import { Message } from "../message.js";
import type { MonthViewRegistry } from "./view-state.js";

export const monthViewportMountFor = (registry?: MonthViewRegistry) =>
  Mount.defineStream("PrepareMonthViewport", {
    execute: ({ element, viewStateChanges }) =>
      Stream.unwrap(
        Effect.gen(function* monthViewport() {
          const lease = yield* Effect.acquireRelease(
            Effect.sync(() => registry?.register()),
            (current) =>
              Effect.sync(() => {
                current?.release();
              })
          );

          const measurements = Stream.callback<
            ReturnType<typeof Message.MeasuredViewport>
          >((queue) =>
            Effect.acquireRelease(
              Effect.sync(() => {
                const measure = () => {
                  const viewport =
                    element.querySelector<HTMLElement>("#month-viewport");

                  const gutter =
                    viewport === null
                      ? 0
                      : viewport.offsetWidth - viewport.clientWidth;

                  Queue.offerUnsafe(
                    queue,
                    Message.MeasuredViewport({
                      gutter,
                      height: element.clientHeight,
                      width: element.clientWidth - gutter,
                    })
                  );
                };

                const observer = new ResizeObserver(measure);
                observer.observe(element);
                measure();

                return observer;
              }),
              (observer) =>
                Effect.sync(() => {
                  observer.disconnect();
                })
            )
          );

          return Stream.merge(
            measurements,
            viewStateChanges.pipe(
              Stream.tap((state) =>
                Effect.sync(() => {
                  lease?.set(state);
                })
              ),
              Stream.drain
            )
          );
        })
      ),
    messages: [Message.MeasuredViewport],
  });

export const PrepareMonthViewport = monthViewportMountFor();

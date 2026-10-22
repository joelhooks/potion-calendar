import { Effect, Queue, Schema, Stream } from "effect";
import { Mount } from "foldkit";

import { gridGeometry, initialScroll } from "../layout/geometry.js";
import { timeAreaHeight, todayScrollLeft } from "../layout/grid-geometry.js";
import { MinuteRange } from "../layout/time-blocks.js";
import { Message } from "./message.js";

export const PrepareTimeGrid = Mount.defineStream("PrepareTimeGrid", {
  args: {
    hidden: Schema.optionalKey(Schema.Array(MinuteRange)),
    initialMinute: Schema.Finite,
    initialScale: Schema.Finite,
  },
  execute: ({ element, hidden, initialMinute, initialScale }) =>
    Stream.callback<ReturnType<typeof Message.MeasuredViewport>>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const viewport = element.querySelector<HTMLElement>("#time-viewport");

          const measure = () => {
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

          if (viewport !== null) {
            viewport.scrollTop = initialScroll(
              initialMinute,
              initialScale,
              timeAreaHeight(viewport),
              gridGeometry(initialScale, hidden)
            );
            viewport.scrollLeft = todayScrollLeft(viewport);
          }

          return observer;
        }),
        (observer) =>
          Effect.sync(() => {
            observer.disconnect();
          })
      )
    ),
  messages: [Message.MeasuredViewport],
});

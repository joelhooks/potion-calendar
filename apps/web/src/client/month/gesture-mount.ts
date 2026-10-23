import { Schema, Stream } from "effect";
import { Mount } from "foldkit";

import type { PrepareGestures } from "../editing/gesture-mount.js";
import { Message } from "../message.js";
import type { PrepareMonthViewport } from "./viewport.js";

export const monthSurfaceMountFor = (
  viewport: typeof PrepareMonthViewport,
  gestures: typeof PrepareGestures
) =>
  Mount.defineStream("PrepareMonthSurface", {
    args: {
      hostKey: Schema.String,
      personId: Schema.String,
      scale: Schema.Finite,
    },
    execute: ({ element, viewStateChanges, hostKey, personId, scale }) =>
      Stream.merge(
        viewport().f(element, viewStateChanges),
        gestures({ hostKey, personId, scale }).f(element, viewStateChanges)
      ),
    messages: [
      Message.MeasuredViewport,
      Message.PhoneSwipedPeriod,
      Message.PreparedGestureHost,
      Message.PreviewedGesture,
      Message.CompletedGesture,
      Message.RefusedGesture,
    ],
  });

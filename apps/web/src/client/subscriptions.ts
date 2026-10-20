import * as BrowserStream from "@effect/platform-browser/BrowserStream";
import { Clock, Effect, Option, Stream } from "effect";
import { Dom, Subscription } from "foldkit";

import { keyAction } from "../layout/navigation.js";
import type { AppModel } from "./app.js";
import { Message } from "./message.js";
import type { AppMessage } from "./message.js";

const shiftedKeys = new Map([
  ["Comma", ","],
  ["Digit0", "0"],
  ["Period", "."],
]);

const keyboardMessage = (event: KeyboardEvent): Option.Option<AppMessage> => {
  if (
    event.target instanceof HTMLElement &&
    event.target.closest(
      "input, textarea, select, [contenteditable='true'], [role='textbox']"
    ) !== null
  ) {
    return Option.none();
  }

  const mod = event.metaKey || event.ctrlKey;
  const shifted = mod && event.shiftKey;

  const key = (shifted ? shiftedKeys.get(event.code) : undefined) ?? event.key;

  const known = shifted
    ? ["e", "d", "a", "0", ".", ","].includes(key.toLowerCase())
    : !mod &&
      !event.altKey &&
      (keyAction(key) !== undefined ||
        ["Escape", "j", "k", "ArrowUp", "ArrowDown"].includes(key));

  if (!known) {
    return Option.none();
  }

  return Option.some(
    Message.PressedCalendarKey({
      alt: event.altKey,
      key,
      mod,
      shift: event.shiftKey,
    })
  );
};

export const subscriptions = Subscription.make<AppModel, AppMessage>()(() => ({
  calendarChanges: Subscription.persistentEntry(
    Stream.suspend(() =>
      Stream.fromEventListener<Event>(window, "calendar-changed").pipe(
        Stream.map(() => Message.CalendarChanged())
      )
    )
  ),
  keyboard: Subscription.persistentEntry(
    Stream.suspend(() =>
      Dom.streamFromEventFilterMapPreventDefault({
        filterMapEvent: keyboardMessage,
        target: window,
        type: "keydown",
      })
    )
  ),
  minuteClock: Subscription.persistentEntry(
    Stream.fromEffectRepeat(
      Effect.gen(function* minuteTick() {
        const now = yield* Clock.currentTimeMillis;
        yield* Effect.sleep(60_000 - (now % 60_000));

        return Message.Ticked({ now: yield* Clock.currentTimeMillis });
      })
    )
  ),
  viewport: Subscription.persistentEntry(
    Stream.suspend(() =>
      BrowserStream.fromEventListenerWindow("resize").pipe(
        Stream.map(() => {
          const grid = document.querySelector(".calendar-view");
          const viewport = grid?.querySelector<HTMLElement>("#time-viewport");

          const gutter =
            viewport === undefined || viewport === null
              ? 0
              : viewport.offsetWidth - viewport.clientWidth;

          return Message.MeasuredViewport({
            gutter,
            height: grid?.clientHeight ?? Math.max(0, window.innerHeight - 56),
            width: (grid?.clientWidth ?? window.innerWidth) - gutter,
          });
        })
      )
    )
  ),
}));

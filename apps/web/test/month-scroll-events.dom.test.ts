import { watchActor } from "@calendar/capability/actor-watch";
import { expect, it } from "@effect/vitest";
import { createEffectActor } from "@xstate/effect";
import { Effect, Option, Queue } from "effect";
import { vi } from "vitest";

import { bindMonthScroll } from "../src/client/month/events.js";
import { monthScrollMachine } from "../src/client/month/scroll-machine.js";

const harness = Effect.fn("monthScrollEventsHarness")(function* harness() {
  const actor = yield* createEffectActor(monthScrollMachine, {
    input: {
      covered: Option.none(),
      hostKey: "person-zone-month",
      rowHeight: 100,
      visibleWeek: 20_000,
    },
  });

  yield* watchActor("calendar.month.scroll.events.test", actor);
  let host: string | undefined = "person-zone-month";

  const viewport = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const element = document.createElement("div");
      element.dataset.monthFirstWeek = String(
        actor.getSnapshot().context.position.firstWeek
      );
      document.body.append(element);

      return element;
    }),
    (element) =>
      Effect.sync(() => {
        element.remove();
      })
  );

  const release = yield* Effect.acquireRelease(
    Effect.sync(() =>
      bindMonthScroll({ actor, readHost: () => host, viewport })
    ),
    (dispose) => Effect.sync(dispose)
  );

  const dispatch = Effect.fn("monthScrollNativeEvent")(function* dispatch(
    type: "scroll" | "scrollend"
  ) {
    const snapshots =
      yield* Queue.unbounded<ReturnType<typeof actor.getSnapshot>>();

    return yield* Effect.acquireUseRelease(
      Effect.sync(() =>
        actor.subscribe((snapshot) => {
          Queue.offerUnsafe(snapshots, snapshot);
        })
      ),
      () =>
        Effect.sync(() => viewport.dispatchEvent(new Event(type))).pipe(
          Effect.andThen(Queue.take(snapshots))
        ),
      (subscription) =>
        Effect.sync(() => {
          subscription.unsubscribe();
        })
    );
  });

  return {
    actor,
    dispatch,
    release,
    setHost: (value: string | undefined) => {
      host = value;
    },
    viewport,
  };
});

it.effect(
  "native scroll bursts defer coverage until scrollend and another end cannot repeat a pending read",
  () =>
    Effect.gen(function* scrollEndCoverage() {
      const h = yield* harness();

      for (let tick = 0; tick < 40; tick += 1) {
        h.viewport.scrollTop = 600 + tick;
        const state = yield* h.dispatch("scroll");
        expect(Option.isNone(state.context.request)).toBe(true);
      }

      const state = yield* h.dispatch("scrollend");
      const request = Option.getOrThrow(state.context.request);
      const repeated = yield* h.dispatch("scrollend");
      expect(repeated.context.request).toEqual(Option.some(request));
    })
);

it.effect(
  "native scroll captures the current focused date before a rebase prepares its bounded pin",
  () =>
    Effect.gen(function* scrollFocusPin() {
      const h = yield* harness();
      const { firstWeek } = h.actor.getSnapshot().context.position;
      h.viewport.innerHTML = `<div class="month-week" data-week-start="${firstWeek + 119}"><div class="month-cell" data-day="${firstWeek + 125}"><button>Date</button></div></div>`;

      const button = yield* Effect.fromNullishOr(
        h.viewport.querySelector("button")
      );

      button.focus();
      h.viewport.scrollTop = 0;
      const state = yield* h.dispatch("scroll");
      expect(Option.getOrThrow(state.context.pendingRebase).pinnedWeek).toEqual(
        Option.some(firstWeek + 119)
      );
    })
);

it.effect(
  "foreign hosts and released bindings cannot send scroll or settled input to the old actor",
  () =>
    Effect.gen(function* scopedScroll() {
      const h = yield* harness();
      const send = vi.spyOn(h.actor, "send");
      h.setHost("another-person-zone-month");
      h.viewport.dispatchEvent(new Event("scroll"));
      h.viewport.dispatchEvent(new Event("scrollend"));
      expect(send).not.toHaveBeenCalled();
      h.setHost("person-zone-month");
      h.release();
      h.viewport.dispatchEvent(new Event("scroll"));
      h.viewport.dispatchEvent(new Event("scrollend"));
      expect(send).not.toHaveBeenCalled();
    })
);

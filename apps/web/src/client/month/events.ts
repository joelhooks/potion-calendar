import type { EffectActor } from "@xstate/effect";
import { Option } from "effect";

import { boundedMonthScrollTop } from "../../layout/month-window.js";
import type { MonthScrollLimits } from "../../layout/month-window.js";
import { monthDayFromText } from "./day-attribute.js";
import type { monthScrollMachine } from "./scroll-machine.js";

interface Input {
  readonly actor: EffectActor<typeof monthScrollMachine>;
  readonly limits?: typeof MonthScrollLimits.Type;
  readonly viewport: HTMLElement;
  readonly readHost: () => string | undefined;
}

const focusedDay = (viewport: HTMLElement): Option.Option<number> => {
  const element = viewport.ownerDocument.activeElement;

  if (!(element instanceof HTMLElement) || !viewport.contains(element)) {
    return Option.none();
  }

  const cell = element.closest<HTMLElement>(".month-cell[data-day]");
  const row = element.closest<HTMLElement>(".month-week[data-week-start]");

  return monthDayFromText(cell?.dataset.day ?? row?.dataset.weekStart);
};

export const bindMonthScroll = ({
  actor,
  limits,
  viewport,
  readHost,
}: Input): (() => void) => {
  const active = () =>
    viewport.isConnected && readHost() === actor.getSnapshot().context.hostKey;

  const scroll = () => {
    if (!active()) {
      return;
    }

    const firstWeek = monthDayFromText(viewport.dataset.monthFirstWeek);

    if (Option.isNone(firstWeek)) {
      return;
    }

    if (limits !== undefined) {
      viewport.scrollTop = boundedMonthScrollTop(
        firstWeek.value,
        viewport.scrollTop,
        actor.getSnapshot().context.rowHeight,
        limits
      );
    }

    actor.send({
      firstWeek: firstWeek.value,
      focusedDay: focusedDay(viewport),
      scrollTop: viewport.scrollTop,
      type: "SCROLL",
    });
  };

  const settled = () => {
    if (active()) {
      actor.send({ type: "SETTLED" });
    }
  };

  viewport.addEventListener("scroll", scroll, { passive: true });
  viewport.addEventListener("scrollend", settled, { passive: true });

  return () => {
    viewport.removeEventListener("scroll", scroll);
    viewport.removeEventListener("scrollend", settled);
  };
};

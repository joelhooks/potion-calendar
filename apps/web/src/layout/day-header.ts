import { dayLabel } from "./presentation.js";

export type DayHeaderForm = "full" | "initial" | "number";

export const dayHeaderForm = (columnWidth: number): DayHeaderForm => {
  if (columnWidth >= 56) {
    return "full";
  }

  return columnWidth >= 32 ? "initial" : "number";
};

export const dayHeaderLabel = (day: number, columnWidth: number) => {
  const form = dayHeaderForm(columnWidth);
  const number = dayLabel(day, { day: "numeric" });

  const labels = {
    full: dayLabel(day, { day: "numeric", weekday: "short" }),
    initial: `${number} ${dayLabel(day, { weekday: "narrow" })}`,
    number,
  };

  return {
    ariaLabel: dayLabel(day, { dateStyle: "full" }),
    form,
    text: labels[form],
  };
};

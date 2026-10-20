import { dayFromIso, partsFromDay } from "./navigation.js";

export const weekNumber = (day: number): number => {
  const weekday = (partsFromDay(day).weekDay + 6) % 7;
  const thursday = day + 3 - weekday;
  const { year } = partsFromDay(thursday);
  const january4 = dayFromIso(`${year}-01-04`);

  const firstThursday =
    january4 + 3 - ((partsFromDay(january4).weekDay + 6) % 7);

  return 1 + Math.floor((thursday - firstThursday) / 7);
};

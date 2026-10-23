import { RemoteEvents } from "../src/client/calendar-state.js";
import { visibleDays } from "../src/layout/navigation.js";
import { timeZonesFixture } from "./time-zones-fixture.js";

export const dayHeadersFixture = (
  width: number,
  theme: "light" | "dark",
  panel: "open" | "closed",
  floor = false
) => {
  const sidebarWidth = width <= 1000 ? 185 : 220;
  const openPanelWidth = width <= 1000 ? 260 : 300;
  const panelWidth = panel === "closed" ? 0 : openPanelWidth;

  const base = timeZonesFixture(
    true,
    theme === "dark",
    width - sidebarWidth - panelWidth
  );

  const available = floor
    ? 46 + 16 * visibleDays(base.calendar.navigation).length
    : width - sidebarWidth - panelWidth;

  return {
    ...base,
    calendar: { ...base.calendar, viewportWidth: available },
    settings: { ...base.settings, hideContextPanel: panel === "closed" },
    upcoming: {
      ...base.upcoming,
      data: RemoteEvents.Success({ data: { events: [], versions: [] } }),
    },
  };
};

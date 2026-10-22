import { gridGeometry, hourHeight } from "../../layout/geometry.js";
import { allDaySection } from "../../layout/presentation.js";
import {
  activeTimeBlocks,
  mergeHiddenRanges,
} from "../../layout/time-blocks.js";
import type { AppModel } from "../app.js";

export const timeGridGeometry = (model: AppModel) => {
  const blocks = activeTimeBlocks(model.settings.timeBlocks);
  const hidden = mergeHiddenRanges(blocks);

  const visibleMinutes =
    1440 -
    hidden.reduce((sum, range) => sum + range.endMinute - range.startMinute, 0);

  const scale = hourHeight(
    model.calendar.zoom,
    model.calendar.viewport,
    allDaySection(model).height,
    visibleMinutes
  );

  return { blocks, grid: gridGeometry(scale, hidden), scale };
};

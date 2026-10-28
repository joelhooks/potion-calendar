import { implement } from "@calendar/capability/implement";

import {
  importCustomVideoLinksContract,
  readCustomVideoLinksContract,
  removeCustomVideoLinkContract,
  saveCustomVideoLinkContract,
} from "./custom-video-link-contracts.js";
import { CalendarSettings } from "./settings.js";

export const readCustomVideoLinks = implement(
  readCustomVideoLinksContract,
  () => CalendarSettings.use((settings) => settings.readCustomVideoLinks())
);

export const importCustomVideoLinks = implement(
  importCustomVideoLinksContract,
  (input) =>
    CalendarSettings.use((settings) => settings.importCustomVideoLinks(input))
);

export const saveCustomVideoLink = implement(
  saveCustomVideoLinkContract,
  (input) =>
    CalendarSettings.use((settings) => settings.saveCustomVideoLink(input))
);

export const removeCustomVideoLink = implement(
  removeCustomVideoLinkContract,
  (input) =>
    CalendarSettings.use((settings) => settings.removeCustomVideoLink(input))
);

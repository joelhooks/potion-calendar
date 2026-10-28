import { implement } from "@calendar/capability/implement";
import { Context } from "effect";
import type { Effect } from "effect";

import {
  getAccountConferencingDefaultContract,
  setAccountConferencingDefaultContract,
} from "./conferencing-contracts.js";
import type {
  AccountConferencingDefault,
  AccountConferencingDefaultFailure,
  GetAccountConferencingDefaultInput,
  SetAccountConferencingDefaultInput,
} from "./conferencing-contracts.js";
import type {
  CustomVideoCatalog,
  ImportCustomVideoLinksInput,
  SaveCustomVideoLinkInput,
  RemoveCustomVideoLinkInput,
  CustomVideoFailure,
} from "./custom-video-link-contracts.js";
import type { CustomVideoLink } from "./custom-video-link.js";
import type { CalendarValue } from "./model.js";
import {
  disconnectAccountContract,
  setCalendarAppearanceContract,
} from "./settings-contracts.js";
import type {
  DisconnectAccountFailure,
  DisconnectAccountInput,
  DisconnectAccountResult,
  SetCalendarAppearanceFailure,
  SetCalendarAppearanceInput,
} from "./settings-contracts.js";

export class CalendarSettings extends Context.Service<
  CalendarSettings,
  {
    readonly readCustomVideoLinks: () => Effect.Effect<
      typeof CustomVideoCatalog.Type,
      typeof CustomVideoFailure.Type
    >;
    readonly importCustomVideoLinks: (
      input: typeof ImportCustomVideoLinksInput.Type
    ) => Effect.Effect<
      typeof CustomVideoCatalog.Type,
      typeof CustomVideoFailure.Type
    >;
    readonly saveCustomVideoLink: (
      input: typeof SaveCustomVideoLinkInput.Type
    ) => Effect.Effect<
      typeof CustomVideoCatalog.Type,
      typeof CustomVideoFailure.Type
    >;
    readonly removeCustomVideoLink: (
      input: typeof RemoveCustomVideoLinkInput.Type
    ) => Effect.Effect<
      typeof CustomVideoCatalog.Type,
      typeof CustomVideoFailure.Type
    >;
    readonly resolveCustomVideoLink: (
      id: string
    ) => Effect.Effect<
      typeof CustomVideoLink.Type,
      typeof CustomVideoFailure.Type
    >;
    readonly getConferencingDefault: (
      input: typeof GetAccountConferencingDefaultInput.Type
    ) => Effect.Effect<
      typeof AccountConferencingDefault.Type,
      typeof AccountConferencingDefaultFailure.Type
    >;
    readonly setConferencingDefault: (
      input: typeof SetAccountConferencingDefaultInput.Type
    ) => Effect.Effect<
      typeof AccountConferencingDefault.Type,
      typeof AccountConferencingDefaultFailure.Type
    >;
    readonly disconnect: (
      input: typeof DisconnectAccountInput.Type
    ) => Effect.Effect<
      typeof DisconnectAccountResult.Type,
      typeof DisconnectAccountFailure.Type
    >;
    readonly setAppearance: (
      input: typeof SetCalendarAppearanceInput.Type
    ) => Effect.Effect<CalendarValue, typeof SetCalendarAppearanceFailure.Type>;
  }
>()("@calendar/calendar/CalendarSettings") {}

export const getAccountConferencingDefault = implement(
  getAccountConferencingDefaultContract,
  (input) =>
    CalendarSettings.use((settings) => settings.getConferencingDefault(input))
);

export const setAccountConferencingDefault = implement(
  setAccountConferencingDefaultContract,
  (input) =>
    CalendarSettings.use((settings) => settings.setConferencingDefault(input))
);

export const disconnectAccount = implement(disconnectAccountContract, (input) =>
  CalendarSettings.use((settings) => settings.disconnect(input))
);

export const setCalendarAppearance = implement(
  setCalendarAppearanceContract,
  (input) => CalendarSettings.use((settings) => settings.setAppearance(input))
);

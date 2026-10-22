import { Option } from "effect";

import {
  addSecondary,
  displayZone,
  hideSecondary,
  promoteZone,
  moveSecondary,
  moveSecondaryTo,
  normalizeZonePreferences,
  persistentZones,
  rememberZone,
  renameZone,
} from "../../layout/time-zones.js";
import type { ZonePreferencesValue } from "../../layout/time-zones.js";
import { TimeZoneAction, displayedZones } from "./model.js";
import type { TimeZonesValue } from "./model.js";
import { TravelEvent, travelTransition } from "./travel-machine.js";

export const applyZonePreferences = (
  zones: TimeZonesValue,
  preferences: ZonePreferencesValue
): TimeZonesValue => {
  const saved = normalizeZonePreferences(preferences);

  return {
    ...zones,
    preferences: { ...saved, lastSystemZone: zones.system },
    systemPrompt:
      saved.askToChange &&
      saved.lastSystemZone !== zones.system &&
      saved.primary.id !== zones.system
        ? Option.some(zones.system)
        : Option.none(),
  };
};

export const changeTimeZones = (
  zones: TimeZonesValue,
  action: typeof TimeZoneAction.Type
): TimeZonesValue =>
  TimeZoneAction.match(action, {
    AcceptSystem: () =>
      Option.match(zones.systemPrompt, {
        onNone: () => zones,
        onSome: (id) => ({
          ...zones,
          ...travelTransition(zones, TravelEvent.cases.Home.make({})),
          preferences: promoteZone(zones.preferences, displayZone(id)),
          systemPrompt: Option.none(),
        }),
      }),
    Add: ({ zone }) => {
      const entry = displayZone(zone.id, zone.label);

      return displayedZones(zones).some((current) => current.id === entry.id)
        ? zones
        : { ...zones, preferences: addSecondary(zones.preferences, entry) };
    },
    AskToChange: ({ enabled }) => ({
      ...zones,
      preferences: { ...zones.preferences, askToChange: enabled },
      systemPrompt: Option.none(),
    }),
    DismissSystem: () => ({ ...zones, systemPrompt: Option.none() }),
    Hide: ({ id }) => ({
      ...zones,
      preferences: hideSecondary(zones.preferences, id),
    }),
    Home: () => ({
      ...zones,
      ...travelTransition(zones, TravelEvent.cases.Home.make({})),
    }),
    Move: ({ id, direction }) => ({
      ...zones,
      preferences: moveSecondary(zones.preferences, id, direction),
    }),
    MoveTo: ({ id, index }) => ({
      ...zones,
      preferences: moveSecondaryTo(zones.preferences, id, index),
    }),
    Open: ({ chooser }) => ({ ...zones, chooser }),
    Primary: ({ id }) => {
      const zone = displayedZones(zones).find((entry) => entry.id === id);

      if (zone === undefined) {
        return zones;
      }

      return {
        ...zones,
        preferences: promoteZone(zones.preferences, zone),
        temporary: zones.temporary.pipe(
          Option.filter((entry) => entry.id !== id)
        ),
      };
    },
    Rename: ({ id, label }) => ({
      ...zones,
      preferences: renameZone(zones.preferences, id, label),
      temporary: zones.temporary.pipe(
        Option.map((entry) =>
          entry.id === id ? { ...entry, label: label.trim() } : entry
        )
      ),
    }),
    Travel: ({ zone }) => {
      const entry = displayZone(zone.id, zone.label);

      if (
        persistentZones(zones.preferences).some(
          (current) => current.id === entry.id
        )
      ) {
        return zones;
      }

      return {
        ...zones,
        ...travelTransition(
          zones,
          TravelEvent.cases.Travel.make({ zone: entry })
        ),
        preferences: rememberZone(zones.preferences, entry.id),
      };
    },
  });

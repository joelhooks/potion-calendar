import { Option, Schema } from "effect";

import {
  DisplayZone,
  ZoneId,
  ZonePreferences,
  displayZone,
  initialZonePreferences,
} from "../../layout/time-zones.js";
import { ZoneDragPreview } from "../zone-drag/model.js";

export const ZoneChooser = Schema.TaggedUnion({
  Add: {},
  Hide: {},
  Manage: { id: ZoneId },
  Move: { direction: Schema.Literals([-1, 1]) },
  Primary: {},
  Rename: {},
  RenameValue: { id: ZoneId },
  Travel: {},
});

export const TimeZoneAction = Schema.TaggedUnion({
  AcceptSystem: {},
  Add: { zone: DisplayZone },
  AskToChange: { enabled: Schema.Boolean },
  DismissSystem: {},
  Hide: { id: ZoneId },
  Home: {},
  Move: { direction: Schema.Literals([-1, 1]), id: ZoneId },
  MoveTo: { hostKey: Schema.String, id: ZoneId, index: Schema.Int },
  Open: { chooser: ZoneChooser },
  Primary: { id: ZoneId },
  Rename: { id: ZoneId, label: Schema.String },
  Travel: { zone: DisplayZone },
});

export const TimeZonesUi = Schema.Struct({
  chooser: ZoneChooser,
  drag: Schema.Option(ZoneDragPreview),
  preferences: ZonePreferences,
  system: ZoneId,
  systemPrompt: Schema.Option(ZoneId),
  temporary: Schema.Option(DisplayZone),
});

export type TimeZonesValue = typeof TimeZonesUi.Type;

export const initialTimeZones = (system: string): TimeZonesValue => ({
  chooser: ZoneChooser.cases.Travel.make({}),
  drag: Option.none(),
  preferences: initialZonePreferences(system),
  system: displayZone(system).id,
  systemPrompt: Option.none(),
  temporary: Option.none(),
});

export const homeZone = (model: {
  readonly timeZones: TimeZonesValue;
}): string => model.timeZones.preferences.primary.id;

export const activeZone = (zones: TimeZonesValue): string =>
  Option.getOrElse(zones.temporary, () => zones.preferences.primary).id;

export const displayedZones = (
  zones: TimeZonesValue
): readonly (typeof DisplayZone.Type)[] => [
  ...zones.preferences.secondary,
  zones.preferences.primary,
  ...Option.toArray(zones.temporary),
];

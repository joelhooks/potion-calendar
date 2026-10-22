import { DateTime, Option, Schema } from "effect";

export const persistentZoneLimit = 4;

export const recentZoneLimit = 5;

export const canonicalZone = (id: string): Option.Option<string> =>
  DateTime.zoneMakeNamed(id).pipe(Option.map(DateTime.zoneToString));

export const ZoneId = Schema.String.check(
  Schema.makeFilter((id) => Option.isSome(canonicalZone(id)))
);

export const DisplayZone = Schema.Struct({ id: ZoneId, label: Schema.String });

export type DisplayZoneValue = typeof DisplayZone.Type;

export const ZonePreferences = Schema.Struct({
  askToChange: Schema.Boolean,
  lastSystemZone: Schema.optionalKey(ZoneId),
  primary: DisplayZone,
  recent: Schema.Array(ZoneId),
  secondary: Schema.Array(DisplayZone),
});

export type ZonePreferencesValue = typeof ZonePreferences.Type;

export const zoneCity = (id: string): string =>
  id.split("/").at(-1)?.replaceAll("_", " ") ?? id;

export const zoneRegion = (id: string): string =>
  id.split("/").slice(0, -1).join(" / ").replaceAll("_", " ");

export const zoneLabel = (zone: DisplayZoneValue): string =>
  zone.label.trim() || zoneCity(zone.id);

export const displayZone = (id: string, label = ""): DisplayZoneValue => ({
  id: Option.getOrThrow(canonicalZone(id)),
  label: label.trim(),
});

export const initialZonePreferences = (
  systemZone: string
): ZonePreferencesValue => ({
  askToChange: true,
  lastSystemZone: displayZone(systemZone).id,
  primary: displayZone(systemZone),
  recent: [],
  secondary: [],
});

export const normalizeZonePreferences = (
  value: ZonePreferencesValue
): ZonePreferencesValue => {
  const primary = displayZone(value.primary.id, value.primary.label);
  const seen = new Set([primary.id]);

  const secondary = value.secondary
    .flatMap((entry) => {
      const zone = displayZone(entry.id, entry.label);

      if (seen.has(zone.id)) {
        return [];
      }

      seen.add(zone.id);

      return [zone];
    })
    .slice(0, persistentZoneLimit - 1);

  const recent = [
    ...new Set(value.recent.map((id) => displayZone(id).id)),
  ].slice(0, recentZoneLimit);

  return {
    ...value,
    lastSystemZone: displayZone(value.lastSystemZone ?? primary.id).id,
    primary,
    recent,
    secondary,
  };
};

export const persistentZones = (
  value: ZonePreferencesValue
): readonly DisplayZoneValue[] => [...value.secondary, value.primary];

export const rememberZone = (
  value: ZonePreferencesValue,
  id: string
): ZonePreferencesValue => ({
  ...value,
  recent: [
    displayZone(id).id,
    ...value.recent.filter((entry) => entry !== displayZone(id).id),
  ].slice(0, recentZoneLimit),
});

export const addSecondary = (
  value: ZonePreferencesValue,
  zone: DisplayZoneValue
): ZonePreferencesValue => {
  const entry = displayZone(zone.id, zone.label);

  if (
    persistentZones(value).some((current) => current.id === entry.id) ||
    value.secondary.length >= persistentZoneLimit - 1
  ) {
    return value;
  }

  return rememberZone(
    { ...value, secondary: [...value.secondary, entry] },
    entry.id
  );
};

export const hideSecondary = (
  value: ZonePreferencesValue,
  id: string
): ZonePreferencesValue => ({
  ...value,
  secondary: value.secondary.filter((entry) => entry.id !== id),
});

export const renameZone = (
  value: ZonePreferencesValue,
  id: string,
  label: string
): ZonePreferencesValue => ({
  ...value,
  primary:
    value.primary.id === id
      ? { ...value.primary, label: label.trim() }
      : value.primary,
  secondary: value.secondary.map((entry) =>
    entry.id === id ? { ...entry, label: label.trim() } : entry
  ),
});

export const promoteZone = (
  value: ZonePreferencesValue,
  zone: DisplayZoneValue
): ZonePreferencesValue => {
  const primary = displayZone(zone.id, zone.label);

  if (primary.id === value.primary.id) {
    return value;
  }

  const secondary = persistentZones(value)
    .filter((entry) => entry.id !== primary.id)
    .slice(-(persistentZoneLimit - 1));

  return rememberZone({ ...value, primary, secondary }, primary.id);
};

export const moveSecondary = (
  value: ZonePreferencesValue,
  id: string,
  direction: -1 | 1
): ZonePreferencesValue => {
  const index = value.secondary.findIndex((zone) => zone.id === id);
  const other = index + direction;
  const current = value.secondary[index];
  const adjacent = value.secondary[other];

  if (current === undefined || adjacent === undefined) {
    return value;
  }

  return {
    ...value,
    secondary: value.secondary.map((entry, position) => {
      if (position === index) {
        return adjacent;
      }

      return position === other ? current : entry;
    }),
  };
};

export const moveSecondaryTo = (
  value: ZonePreferencesValue,
  id: string,
  destination: number
): ZonePreferencesValue => {
  const origin = value.secondary.findIndex((zone) => zone.id === id);

  if (
    origin === -1 ||
    !Number.isInteger(destination) ||
    destination < 0 ||
    destination >= value.secondary.length
  ) {
    return value;
  }

  const direction = origin < destination ? 1 : -1;
  let moved = value;

  for (let index = origin; index !== destination; index += direction) {
    moved = moveSecondary(moved, id, direction);
  }

  return moved;
};

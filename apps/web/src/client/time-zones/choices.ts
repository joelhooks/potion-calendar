import { Option } from "effect";

import { zoneCatalog, zoneOffset } from "../../layout/time-zones-display.js";
import {
  displayZone,
  persistentZoneLimit,
  zoneCity,
  zoneLabel,
  zoneRegion,
} from "../../layout/time-zones.js";
import type { AppModel } from "../app.js";
import type { CommandChoice } from "../keyboard/choices.js";
import { Message } from "../message.js";
import { TimeZoneAction, ZoneChooser, displayedZones } from "./model.js";

const catalog = zoneCatalog();

const choice = (
  id: string,
  title: string,
  action: typeof TimeZoneAction.Type
): CommandChoice => ({
  disabled: false,
  exact: false,
  id,
  keys: [],
  message: Message.TimeZoneAction({ action }),
  score: 1,
  section: "Time zones",
  title,
});

export const zoneChooserHeading = (model: AppModel): string =>
  ZoneChooser.match(model.timeZones.chooser, {
    Add: () => "Add secondary time zone",
    Hide: () => "Hide time zone",
    Manage: ({ id }) => `Time zone: ${zoneCity(id)}`,
    Move: ({ direction }) =>
      direction < 0 ? "Move time zone left" : "Move time zone right",
    Primary: () => "Make primary time zone",
    Rename: () => "Rename time zone",
    RenameValue: () => "Time-zone label",
    Travel: () => "Travel to time zone",
  });

const open = (chooser: typeof ZoneChooser.Type) =>
  TimeZoneAction.cases.Open.make({ chooser });

export const timeZoneChoices = (model: AppModel): readonly CommandChoice[] => {
  const zones = model.timeZones;
  const shown = displayedZones(zones);
  const query = model.keyboard.query.trim().toLowerCase();

  const existing = (
    action: (id: string) => typeof TimeZoneAction.Type,
    eligible: (id: string) => boolean
  ): readonly CommandChoice[] =>
    shown
      .filter((zone) => eligible(zone.id))
      .map((zone) =>
        choice(zone.id, `${zoneLabel(zone)} · ${zone.id}`, action(zone.id))
      );

  const choices = ZoneChooser.match<readonly CommandChoice[]>(zones.chooser, {
    Add: () =>
      zones.preferences.secondary.length >= persistentZoneLimit - 1
        ? []
        : catalog
            .filter((zone) => !shown.some((current) => current.id === zone.id))
            .map((zone) =>
              choice(
                zone.id,
                `${zone.city} · ${zone.region} · ${zoneOffset(model.calendar.now, zone.id)}`,
                TimeZoneAction.cases.Add.make({ zone: displayZone(zone.id) })
              )
            ),
    Hide: () =>
      existing(
        (id) => TimeZoneAction.cases.Hide.make({ id }),
        (id) => zones.preferences.secondary.some((zone) => zone.id === id)
      ),
    Manage: ({ id }) => {
      const index = zones.preferences.secondary.findIndex(
        (zone) => zone.id === id
      );

      const secondary = index !== -1;
      const isTemporary = Option.isSome(zones.temporary);

      return [
        choice(
          "zone-travel",
          "Travel temporarily",
          open(ZoneChooser.cases.Travel.make({}))
        ),
        ...(id === zones.preferences.primary.id
          ? []
          : [
              choice(
                "zone-primary",
                "Make primary time zone",
                TimeZoneAction.cases.Primary.make({ id })
              ),
            ]),
        choice(
          "zone-rename",
          "Rename time zone",
          open(ZoneChooser.cases.RenameValue.make({ id }))
        ),
        ...(secondary
          ? [
              choice(
                "zone-hide",
                "Hide time zone",
                TimeZoneAction.cases.Hide.make({ id })
              ),
            ]
          : []),
        ...(index > 0
          ? [
              choice(
                "zone-left",
                "Move time zone left",
                TimeZoneAction.cases.Move.make({ direction: -1, id })
              ),
            ]
          : []),
        ...(secondary && index < zones.preferences.secondary.length - 1
          ? [
              choice(
                "zone-right",
                "Move time zone right",
                TimeZoneAction.cases.Move.make({ direction: 1, id })
              ),
            ]
          : []),
        ...(isTemporary
          ? [
              choice(
                "zone-home",
                "Return home",
                TimeZoneAction.cases.Home.make({})
              ),
            ]
          : []),
        ...(zones.preferences.secondary.length < persistentZoneLimit - 1
          ? [
              choice(
                "zone-add",
                "Add secondary time zone",
                open(ZoneChooser.cases.Add.make({}))
              ),
            ]
          : []),
      ];
    },
    Move: ({ direction }) =>
      existing(
        (id) => TimeZoneAction.cases.Move.make({ direction, id }),
        (id) => {
          const index = zones.preferences.secondary.findIndex(
            (zone) => zone.id === id
          );

          return (
            index !== -1 &&
            index + direction >= 0 &&
            index + direction < zones.preferences.secondary.length
          );
        }
      ),
    Primary: () =>
      existing(
        (id) => TimeZoneAction.cases.Primary.make({ id }),
        (id) => id !== zones.preferences.primary.id
      ),
    Rename: () =>
      existing(
        (id) => open(ZoneChooser.cases.RenameValue.make({ id })),
        () => true
      ),
    RenameValue: ({ id }) => [
      choice(
        "zone-label",
        query === ""
          ? "Restore default label"
          : `Use label “${model.keyboard.query.trim()}”`,
        TimeZoneAction.cases.Rename.make({
          id,
          label: model.keyboard.query.trim(),
        })
      ),
    ],
    Travel: () => {
      const recent = zones.preferences.recent.filter(
        (id) => !shown.some((zone) => zone.id === id)
      );

      const remaining = catalog
        .filter(
          (zone) =>
            !shown.some((current) => current.id === zone.id) &&
            !recent.includes(zone.id)
        )
        .map((zone) => zone.id);

      return [...recent, ...remaining].map((id) =>
        choice(
          id,
          `${zoneCity(id)} · ${zoneRegion(id)} · ${zoneOffset(model.calendar.now, id)}${recent.includes(id) ? " · Recent" : ""}`,
          TimeZoneAction.cases.Travel.make({ zone: displayZone(id) })
        )
      );
    },
  });

  if (ZoneChooser.guards.RenameValue(zones.chooser)) {
    return choices;
  }

  return choices
    .filter(
      (entry) =>
        query === "" ||
        `${entry.title} ${entry.id}`.toLowerCase().includes(query)
    )
    .map((entry) => ({
      ...entry,
      exact:
        query !== "" &&
        [
          entry.id.toLowerCase(),
          zoneCity(entry.id).toLowerCase(),
          entry.title.toLowerCase(),
        ].includes(query),
    }));
};

import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import {
  IcsSelection,
  selectedIcsEvents,
} from "../src/client/ics-export/selection.js";
import { keyboardRegistry } from "../src/client/keyboard/registry.js";
import { icsExportFixture } from "./ics-export-fixture.js";

it.prop(
  "ICS command selects the whole current-person selection and schedules exactly one local download without changing calendar data",
  { multiple: Schema.Boolean },
  ({ multiple }) => {
    const base = icsExportFixture(multiple);

    const opened = update(
      base,
      Message.KeyboardAction({ id: "commands" })
    ).model;

    const action = keyboardRegistry.find(
      (candidate) => candidate.id === "export-ics"
    );

    expect(action?.title).toBe("Export as .ics");
    expect(action?.availability(opened)).toBe("enabled");
    const result = update(opened, Message.KeyboardPick({ id: "export-ics" }));

    expect(result.commands?.map((command) => command.name)).toEqual([
      "DownloadSelectedIcs",
    ]);
    expect(result.model.calendar).toBe(opened.calendar);
    expect(result.model.keyboard.screen).toBe("closed");
    expect(result.commands?.[0]?.args).toMatchObject({
      personId: Option.getOrThrow(opened.person),
      revision: 1,
    });
    const selection = selectedIcsEvents(opened);
    expect(IcsSelection.guards.Ready(selection)).toBe(true);

    if (IcsSelection.guards.Ready(selection)) {
      expect(selection.events).toHaveLength(multiple ? 2 : 1);
      expect(result.commands?.[0]?.args).toMatchObject({
        events: selection.events,
      });
    }
  }
);

it.effect(
  "ICS command is absent with no selection, desktop availability or unresolved desktop capability",
  () =>
    Effect.sync(() => {
      const base = icsExportFixture();

      const action = keyboardRegistry.find(
        (candidate) => candidate.id === "export-ics"
      );

      for (const model of [
        { ...base, calendar: { ...base.calendar, selected: [] } },
        ...(["available", "unknown"] as const).map((availability) => ({
          ...base,
          desktop: { ...base.desktop, availability },
        })),
      ]) {
        expect(action?.availability(model)).toBe("hidden");
        expect(
          update(model, Message.RequestedIcsExport()).commands ?? []
        ).toHaveLength(0);
      }
    })
);

it.effect(
  "ICS refuses missing selection members rather than silently exporting a smaller file",
  () =>
    Effect.sync(() => {
      const base = icsExportFixture();

      const model = {
        ...base,
        calendar: {
          ...base.calendar,
          selected: [...base.calendar.selected, "missing-selection-key"],
        },
      };

      expect(selectedIcsEvents(model)).toMatchObject({
        reason: "missingSource",
      });
      const result = update(model, Message.RequestedIcsExport());
      expect(result.commands ?? []).toHaveLength(0);
      expect(
        Option.getOrThrow(result.model.icsExport.notice).message
      ).toContain("no longer available");
    })
);

it.prop(
  "ICS completion receipts reject a different person or superseded export revision",
  { revision: Schema.Int },
  ({ revision }) => {
    const base = icsExportFixture();
    const model = { ...base, icsExport: { notice: Option.none(), revision } };
    const personId = Option.getOrThrow(base.person);

    for (const notice of [
      { message: "Download started.", personId: `${personId}-other`, revision },
      { message: "Download started.", personId, revision: revision + 1 },
    ]) {
      expect(update(model, Message.ReceivedIcsExport({ notice })).model).toBe(
        model
      );
    }

    const accepted = update(
      model,
      Message.ReceivedIcsExport({
        notice: { message: "Download started.", personId, revision },
      })
    ).model;

    expect(Option.getOrThrow(accepted.icsExport.notice).message).toBe(
      "Download started."
    );
    expect(
      update(accepted, Message.DismissedIcsExport({ personId, revision })).model
        .icsExport.notice
    ).toEqual(Option.none());
  }
);

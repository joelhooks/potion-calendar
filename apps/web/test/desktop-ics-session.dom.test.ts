import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { AsyncData } from "foldkit";
import { renderToString } from "foldkit/experimental/server";

import { initialModel, Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { DesktopNotice, DesktopOutcome } from "../src/client/desktop/model.js";
import { commandChoices } from "../src/client/keyboard/choices.js";
import { keyboardRegistry } from "../src/client/keyboard/registry.js";
import { LiveNotice } from "../src/client/live/protocol.js";
import { AccountDeletionReply } from "../src/client/settings/delete-account/model.js";
import { view as appView } from "../src/features/app.js";
import { fixtureIndex } from "./fixture.js";
import { icsExportFixture } from "./ics-export-fixture.js";

const settings = {
  issues: [],
  openAtLogin: false,
  preferences: defaultDesktopPreferences(),
  revision: 8,
};

const nativeRead = (canSaveIcs: boolean) =>
  Message.ReceivedDesktop({
    notice: DesktopNotice.cases.Finished.make({
      canSaveIcs,
      outcome: DesktopOutcome.cases.Ready.make({
        error: Option.none(),
        settings,
      }),
      request: 0,
    }),
  });

const sessionFixture = () => {
  const selected = icsExportFixture();
  const snapshot = Option.getOrThrow(AsyncData.getData(selected.session));

  if (snapshot === null) {
    throw new Error("ICS session fixture must be signed in");
  }

  return { selected, snapshot };
};

const loadSelection = (model: AppModel, selected: AppModel): AppModel => {
  const personId = Option.getOrThrow(model.person);

  let current = update(
    model,
    Message.ReceivedCalendars({ personId, result: fixtureIndex })
  ).model;

  for (const read of selected.calendar.reads) {
    const result = Option.getOrThrow(AsyncData.getData(read.events));
    current = update(
      current,
      Message.ReceivedEvents({
        accountId: read.accountId,
        request: current.calendar.rangeRequest,
        result,
      })
    ).model;
  }

  return update(
    current,
    Message.ClickedEvent({
      key: Option.getOrThrow(
        Option.fromUndefinedOr(selected.calendar.selected[0])
      ),
    })
  ).model;
};

const enabled = (model: AppModel) =>
  keyboardRegistry
    .find((action) => action.id === "export-ics")
    ?.availability(model);

it.effect(
  "desktop-before-session arrival preserves the enabled ICS command through the real root update",
  () =>
    Effect.gen(function* nativeArrivalOrder() {
      const { selected, snapshot } = sessionFixture();

      let model = initialModel(
        selected.calendar.now,
        selected.timeZones.system
      );

      ({ model } = update(model, nativeRead(true)));
      ({ model } = update(model, Message.ReceivedSession({ snapshot })));
      model = loadSelection(model, selected);
      ({ model } = update(model, Message.KeyboardAction({ id: "commands" })));
      expect(enabled(model)).toBe("enabled");

      const rendered = yield* renderToString(
        { init: () => ({ model }), view: appView },
        { isHydratable: false }
      );

      const row = new DOMParser()
        .parseFromString(rendered.html, "text/html")
        .querySelector("#command-export-ics");

      expect(row?.getAttribute("role")).toBe("option");
      expect(row?.getAttribute("aria-disabled")).toBe("false");
    })
);

it.prop(
  "both arrival orders preserve actual capability without inventing support for an older bridge",
  {
    canSaveIcs: Schema.Boolean,
    settingsFirst: Schema.Boolean,
  },
  ({ canSaveIcs, settingsFirst }) => {
    const { selected, snapshot } = sessionFixture();
    let model = initialModel(selected.calendar.now, selected.timeZones.system);
    const ready = nativeRead(canSaveIcs);
    const session = Message.ReceivedSession({ snapshot });

    for (const message of settingsFirst ? [ready, session] : [session, ready]) {
      ({ model } = update(model, message));
    }

    model = loadSelection(model, selected);
    expect(enabled(model)).toBe(canSaveIcs ? "enabled" : "hidden");
    expect(model.desktop.canSaveIcs).toBe(canSaveIcs);
  }
);

it.effect(
  "sign-out, person switch and both deletion resets retain device capability while discarding person data",
  () =>
    Effect.sync(() => {
      const { selected, snapshot } = sessionFixture();
      let base = initialModel(selected.calendar.now, selected.timeZones.system);
      ({ model: base } = update(base, nativeRead(true)));
      ({ model: base } = update(base, Message.ReceivedSession({ snapshot })));
      base = loadSelection(base, selected);
      const personId = Option.getOrThrow(base.person);
      const signingOut = update(base, Message.ClickedSignOut()).model;
      expect(signingOut.desktop).toBe(base.desktop);

      const switching = {
        ...snapshot,
        user: { ...snapshot.user, id: "other-person" },
      };

      const deleting = {
        ...base,
        accountDeletion: {
          ...base.accountDeletion,
          mode: "deleting",
          personId: base.person,
          sequence: 1,
        },
      } satisfies AppModel;

      const outcomes = [
        update(signingOut, Message.ReceivedSession({ snapshot: null })).model,
        update(base, Message.ReceivedSession({ snapshot: switching })).model,
        update(
          base,
          Message.ReceivedLive({
            notice: LiveNotice.cases.SessionEnded.make({ deleted: true }),
            personId,
          })
        ).model,
        update(
          deleting,
          Message.AccountDeletionCompleted({
            personId,
            reply: AccountDeletionReply.cases.Deleted.make({}),
            sequence: 1,
          })
        ).model,
      ];

      for (const model of outcomes) {
        expect(model.desktop.canSaveIcs).toBe(true);
        expect(model.desktop.availability).toBe("available");
        expect(model.desktop.settings).toBe(base.desktop.settings);
        expect(model.desktop.request).toBe(base.desktop.request);
        expect(Option.isNone(model.desktop.error)).toBe(true);
        expect(model.calendar.selected).toEqual([]);
        expect(model.calendar.reads).toEqual([]);
        expect(enabled(model)).toBe("hidden");
      }
    })
);

it.effect(
  "the filtered ICS menu has one export row and a separate search-fallback row with a different recipient",
  () =>
    Effect.gen(function* filteredCatalogRows() {
      const { selected, snapshot } = sessionFixture();

      let model = initialModel(
        selected.calendar.now,
        selected.timeZones.system
      );

      ({ model } = update(model, Message.ReceivedSession({ snapshot })));
      ({ model } = update(model, nativeRead(true)));
      model = loadSelection(model, selected);
      ({ model } = update(model, Message.KeyboardAction({ id: "commands" })));
      ({ model } = update(
        model,
        Message.KeyboardQuery({ query: "Export as .ics" })
      ));
      const choices = commandChoices(model);
      expect(choices.map((choice) => choice.id)).toEqual([
        "export-ics",
        "search-query",
      ]);
      expect(choices.map((choice) => choice.title)).toEqual([
        "Export as .ics",
        "Search events for “Export as .ics”",
      ]);
      expect(choices[0]?.message).toEqual(Message.RequestedIcsExport());
      expect(choices[1]?.message).toEqual(
        Message.SearchOpened({ query: Option.some("Export as .ics") })
      );

      const rendered = yield* renderToString(
        { init: () => ({ model }), view: appView },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      const rows = [
        ...document.querySelectorAll('#keyboard-choices [role="option"]'),
      ];

      expect(rows.map((row) => row.id)).toEqual([
        "command-export-ics",
        "command-search-query",
      ]);
      expect(
        rows.filter((row) => row.textContent?.includes("Export as .ics"))
      ).toHaveLength(2);
    })
);

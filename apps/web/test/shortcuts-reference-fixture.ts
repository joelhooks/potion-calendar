import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import type { DesktopPreferencesValue } from "@calendar/core/desktop-bridge";
import { pipe } from "effect";
import { AsyncData } from "foldkit";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { DesktopNotice, DesktopOutcome } from "../src/client/desktop/model.js";
import { keyboardFixture } from "./keyboard-fixture.js";

export const shortcutsReferenceFixture = (
  bindings: Pick<DesktopPreferencesValue, "menuShortcut" | "joinShortcut">,
  theme: AppModel["settings"]["theme"] = "light",
  native = true
): AppModel => {
  const base = keyboardFixture();

  const notice = native
    ? DesktopNotice.cases.Settings.make({
        settings: {
          issues: [],
          openAtLogin: false,
          preferences: { ...defaultDesktopPreferences(), ...bindings },
          revision: 1,
        },
      })
    : DesktopNotice.cases.Finished.make({
        outcome: DesktopOutcome.cases.Unavailable.make({}),
        request: base.desktop.request,
      });

  const observed = update(base, Message.ReceivedDesktop({ notice })).model;

  const opened = update(
    observed,
    Message.KeyboardAction({ id: "shortcuts" })
  ).model;

  return { ...opened, settings: { ...opened.settings, theme } };
};

export const readOnlyCommandsFixture = (): AppModel => {
  const base = keyboardFixture();

  const calendars: AppModel["calendar"]["calendars"] = base.calendar.calendars
    .filter((calendar) => calendar.accountId === "work")
    .map((calendar) => ({ ...calendar, accessRole: "reader" }));

  const model: AppModel = {
    ...base,
    calendar: {
      ...base.calendar,
      calendars,
      index: pipe(
        base.calendar.index,
        AsyncData.map((index) => ({
          ...index,
          accounts: index.accounts
            .filter((account) => account.accountId === "work")
            .map((account) =>
              "calendars" in account ? { ...account, calendars } : account
            ),
        }))
      ),
      reads: base.calendar.reads.filter((read) => read.accountId === "work"),
    },
    session: pipe(
      base.session,
      AsyncData.map((session) =>
        session === null
          ? null
          : {
              ...session,
              accounts: session.accounts.filter(
                (account) => account.id === "work"
              ),
            }
      )
    ),
    settings: { ...base.settings, theme: "light" },
  };

  return update(model, Message.KeyboardAction({ id: "commands" })).model;
};

import type { AgendaEventValue } from "@calendar/core/desktop-bridge";
import { trayDisplayText, trayPlainText } from "@calendar/core/desktop-bridge";
import { Match } from "effect";
import type { MenuItemConstructorOptions } from "electron";

import { trayAgenda } from "./agenda.js";
import { NativeIntent } from "./native-host.js";
import type { NativeIntentValue, NativeView } from "./native-host.js";
import { trayResponseMenu } from "./tray-response.js";

export type TrayMenuItem = Omit<
  MenuItemConstructorOptions,
  "submenu" | "icon" | "click"
> & {
  readonly calendarColor?: string;
  readonly click?: () => void;
  readonly submenu?: TrayMenuItem[];
};

const responseLabel = (event: AgendaEventValue) =>
  Match.value(event.responseStatus).pipe(
    Match.when("tentative", () => "Maybe · "),
    Match.when("needsAction", () => "Unanswered · "),
    Match.orElse(() => "")
  );

export const trayMenuRows = (
  view: NativeView,
  format: {
    readonly day: (value: number) => string;
    readonly time: (value: number) => string;
  },
  intent: (value: NativeIntentValue) => void
): TrayMenuItem[] => {
  const { current, remaining } = trayAgenda(
    view.agenda,
    view.preferences,
    view.now
  );

  const label = (event: AgendaEventValue) =>
    [
      event.allDay ? "All-day" : format.time(event.start),
      `${responseLabel(event)}${trayDisplayText(event.title, 512)}`,
      event.trayDetails?.location ?? "",
    ]
      .filter(Boolean)
      .join("  ");

  const show = (event: AgendaEventValue) => () => {
    intent(NativeIntent.cases.TrayShowEvent.make({ key: event.key }));
  };

  const rows: TrayMenuItem[] = [];

  if (current !== undefined) {
    const actions: TrayMenuItem[] = [];

    if (current.conferenceUrl === null) {
      actions.push(
        {
          enabled: false,
          id: "tray-current-no-conferencing",
          label: "Meeting has no conferencing",
        },
        {
          click: show(current),
          id: "tray-current-select-event",
          label: "Select event",
        }
      );
    } else {
      const { conferenceUrl, key } = current;
      actions.push({
        click: () => {
          intent(
            NativeIntent.cases.TrayJoin.make({
              conferenceUrl,
              key,
              section: "current",
            })
          );
        },
        id: "tray-current-join",
        label: "Join",
      });
    }

    const attachments = current.trayDetails?.attachments ?? [];

    if (attachments.length > 0) {
      actions.push({
        id: "tray-current-attachments",
        label: "Attachments",
        submenu: attachments.map((attachment) => ({
          click: () => {
            intent(
              NativeIntent.cases.TrayAttachment.make({
                index: attachment.index,
                key: current.key,
                url: attachment.url,
              })
            );
          },
          id: `tray-current-attachment-${attachment.index}`,
          label: trayPlainText(attachment.title),
        })),
      });
    }

    const email = current.trayDetails?.email;

    if (email !== undefined && email !== null) {
      actions.push({
        click: () => {
          intent(
            NativeIntent.cases.TrayEmail.make({
              href: email.href,
              key: current.key,
            })
          );
        },
        id: "tray-current-email-participants",
        label: "Email participants",
      });
    } else if (current.hasParticipants && current.trayDetails !== undefined) {
      actions.push({
        enabled: false,
        id: "tray-current-email-participants",
        label: "Email participants",
      });
    }

    actions.push(
      ...trayResponseMenu(current, intent, view.agenda.notificationAgenda),
      {
        click: show(current),
        id: "tray-current-show-event",
        label: "Show event",
      }
    );
    rows.push(
      {
        enabled: false,
        id: "tray-current-section",
        label:
          current.start <= view.now ? "Current meeting" : "Upcoming meeting",
      },
      {
        calendarColor: current.calendarColor,
        id: "tray-current-event",
        label: label(current),
        submenu: actions,
      }
    );

    if (remaining.length > 0) {
      rows.push({ id: "tray-current-separator", type: "separator" });
    }
  }

  let group = "";

  for (const [index, event] of remaining.entries()) {
    const heading = format.day(event.start);

    if (heading !== group) {
      rows.push({
        enabled: false,
        id: `tray-day-heading-${index}`,
        label: heading,
      });
      group = heading;
    }

    const actions: TrayMenuItem[] = [];

    if (event.conferenceUrl !== null) {
      const { conferenceUrl, key } = event;
      actions.push({
        click: () => {
          intent(
            NativeIntent.cases.TrayJoin.make({
              conferenceUrl,
              key,
              section: "day",
            })
          );
        },
        id: `tray-day-join-${index}`,
        label: "Join",
      });
    }

    actions.push({
      click: show(event),
      id: `tray-day-show-event-${index}`,
      label: "Show event",
    });
    rows.push({
      calendarColor: event.calendarColor,
      id: `tray-day-event-${index}`,
      label: label(event),
      submenu: actions,
    });
  }

  if (rows.length === 0) {
    rows.push({
      enabled: false,
      id: "tray-empty",
      label: "No upcoming meeting",
    });
  }

  return rows;
};

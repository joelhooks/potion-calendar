import type {
  AgendaEventValue,
  DesktopAction,
  NativeNotificationAgenda,
} from "@calendar/core/desktop-bridge";
import type { MenuItemConstructorOptions } from "electron";

import { NativeIntent } from "./native-host.js";
import type { NativeIntentValue } from "./native-host.js";

type TrayResponseItem = Pick<
  MenuItemConstructorOptions,
  "id" | "label" | "accelerator" | "enabled" | "checked" | "type"
> & {
  click?: () => void;
  submenu?: TrayResponseItem[];
};

const choices: readonly {
  readonly accelerator: string;
  readonly id: string;
  readonly label: string;
  readonly response: typeof DesktopAction.cases.RespondToEvent.fields.response.Type;
}[] = [
  {
    accelerator: "Y",
    id: "tray-response-yes",
    label: "Yes",
    response: "accepted",
  },
  {
    accelerator: "N",
    id: "tray-response-no",
    label: "No",
    response: "declined",
  },
  {
    accelerator: "M",
    id: "tray-response-maybe",
    label: "Maybe",
    response: "tentative",
  },
];

export const trayResponseMenu = (
  event: AgendaEventValue | undefined,
  intent: (value: NativeIntentValue) => void,
  owner?: typeof NativeNotificationAgenda.Type
): TrayResponseItem[] => {
  if (event?.rsvp === undefined) {
    return [];
  }

  const { rsvp } = event;

  return [
    {
      enabled: rsvp.enabled,
      id: "tray-respond",
      label:
        rsvp.response === null || rsvp.response === "needsAction"
          ? "Respond"
          : "Update response",
      submenu: [
        ...choices.map<TrayResponseItem>((choice) => ({
          accelerator: choice.accelerator,
          checked: rsvp.response === choice.response,
          click: () => {
            intent(
              NativeIntent.cases.RespondToEvent.make({
                key: event.key,
                response: choice.response,
              })
            );
          },
          enabled: rsvp.enabled,
          id: choice.id,
          label: choice.label,
          type: "checkbox",
        })),
        { type: "separator" },
        ...choices.map<TrayResponseItem>((choice) => ({
          accelerator: `Shift+${choice.accelerator}`,
          click: () => {
            if (
              !rsvp.enabled ||
              owner === undefined ||
              owner.personId === null
            ) {
              return;
            }

            intent(
              NativeIntent.cases.PrepareRsvpNote.make({
                key: event.key,
                lease: owner.lease,
                personId: owner.personId,
                response: choice.response,
                start: event.start,
              })
            );
          },
          enabled:
            rsvp.enabled && owner !== undefined && owner.personId !== null,
          id: choice.id.replace("tray-response-", "tray-note-"),
          label: `${choice.label} with note…`,
        })),
      ],
    },
  ];
};

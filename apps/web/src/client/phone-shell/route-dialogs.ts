import { CalendarRoute } from "../../layout/route.js";
import { Message } from "../message.js";
import { reconcileModalDialog } from "./dialog.js";

export type PhoneRouteMessage = ReturnType<typeof Message.RequestedRoute>;

export const attachPhoneRouteSheets = (
  element: Element,
  send: (message: PhoneRouteMessage) => void
): (() => void) =>
  reconcileModalDialog(element, {
    close: () => {
      send(
        Message.RequestedRoute({
          replace: true,
          route: CalendarRoute.make({}),
        })
      );
    },
    fallbackId: "command-menu-button",
    selector: "dialog[data-phone-route-dialog]",
  });

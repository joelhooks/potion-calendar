import { Message } from "../message.js";
import { reconcileModalDialog } from "./dialog.js";

export type PhoneShellMessage =
  | ReturnType<typeof Message.MeasuredShellViewport>
  | ReturnType<typeof Message.PhoneShellClosed>;

export const attachPhoneShell = (
  element: Element,
  send: (message: PhoneShellMessage) => void
): (() => void) => {
  const view = element.ownerDocument.defaultView;

  const close = () => {
    send(Message.PhoneShellClosed());
  };

  const measure = () => {
    const width = element.ownerDocument.documentElement.clientWidth;

    if (width > 0) {
      send(Message.MeasuredShellViewport({ width }));
    }
  };

  const disposeDialog = reconcileModalDialog(element, {
    close,
    fallbackId: "phone-calendars-button",
    selector: "[data-phone-shell-dialog]",
  });

  const select = (event: Event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    if (
      event.target.closest(
        "[data-phone-shell-dialog='drawer'] .sidebar :is(button, a, input, select)"
      ) !== null
    ) {
      close();
    }
  };

  element.addEventListener("click", select);
  view?.addEventListener("resize", measure);
  measure();

  return () => {
    disposeDialog();
    element.removeEventListener("click", select);
    view?.removeEventListener("resize", measure);
  };
};

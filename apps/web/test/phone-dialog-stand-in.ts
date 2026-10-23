import { vi } from "vitest";

export const installPhoneDialogStandIn = (dialog: HTMLDialogElement) => {
  const show = vi.fn(() => {
    dialog.setAttribute("open", "");
  });

  const close = vi.fn(() => {
    dialog.removeAttribute("open");
  });

  Object.defineProperties(dialog, {
    close: { configurable: true, value: close },
    showModal: { configurable: true, value: show },
  });

  return { close, show };
};

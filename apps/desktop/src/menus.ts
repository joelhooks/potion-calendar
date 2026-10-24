import type { MenuItemConstructorOptions } from "electron";

import { NativeIntent } from "./native-host.js";
import type { NativeIntentValue } from "./native-host.js";

type ApplicationMenuItem = Pick<
  MenuItemConstructorOptions,
  "role" | "type" | "label" | "id" | "accelerator"
> & {
  click?: () => void;
  submenu?: ApplicationMenuItem[];
};

export const applicationMenu = (
  signIn: () => void,
  intent: (value: NativeIntentValue) => void
) => {
  const template: ApplicationMenuItem[] = [
    {
      label: "Potion Calendar",
      submenu: [
        { role: "about" },
        { click: signIn, id: "sign-in", label: "Sign In…" },
        {
          accelerator: "CmdOrCtrl+1",
          click: () => {
            intent(NativeIntent.cases.OpenWindow.make({}));
          },
          label: "Show Calendar Window",
        },
        {
          accelerator: "CmdOrCtrl+,",
          click: () => {
            intent(NativeIntent.cases.OpenSettings.make({ page: "general" }));
          },
          label: "Settings…",
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];

  return template;
};

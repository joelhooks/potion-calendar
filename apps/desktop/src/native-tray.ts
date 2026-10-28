import type { PromptPreferences } from "@calendar/core/desktop-bridge";
import { Clock, Context, DateTime, Effect, Layer, Option, Ref } from "effect";
import { Menu, Tray, nativeImage } from "electron";
import type { MenuItemConstructorOptions, NativeImage } from "electron";

import { previewLabel } from "./agenda.js";
import { DesktopError } from "./config.js";
import { NativeIntent } from "./native-host.js";
import type { NativeIntentValue, NativeView } from "./native-host.js";
import { nativeLocaleOptions } from "./native-locale.js";
import {
  calendarDotPng,
  trayIconPng,
  trayIconState,
  trayIconStandardScale,
  trayIconRetinaScale,
  trayIconTemplate,
} from "./tray-icon.js";
import { trayMenuRows } from "./tray-menu.js";
import type { TrayMenuItem } from "./tray-menu.js";

export interface TrayBitmap {
  readonly isEmpty: () => boolean;
  readonly addRepresentation: (options: {
    buffer: Buffer;
    scaleFactor: number;
  }) => void;
  readonly setTemplateImage: (value: boolean) => void;
}

export type TrayRow<Image> = Omit<
  MenuItemConstructorOptions,
  "icon" | "submenu"
> & {
  icon?: Image;
  submenu?: TrayRow<Image>[];
};

export interface TrayHandle<Image, MenuValue> {
  readonly isDestroyed: () => boolean;
  readonly destroy: () => void;
  readonly setImage: (image: Image) => void;
  readonly setToolTip: (value: string) => void;
  readonly setTitle: (value: string) => void;
  readonly setContextMenu: (menu: MenuValue) => void;
  readonly closeContextMenu: () => void;
  readonly popUpContextMenu: () => void;
}

export interface TrayPlatform<Image extends TrayBitmap, MenuValue> {
  readonly createImage: (
    buffer: Buffer,
    options: { scaleFactor: number }
  ) => Image;
  readonly createTray: (image: Image) => TrayHandle<Image, MenuValue>;
  readonly createMenu: (rows: TrayRow<Image>[]) => MenuValue;
  readonly onMenuShow: (menu: MenuValue, listener: () => void) => void;
  readonly onMenuClose: (menu: MenuValue, listener: () => void) => void;
}

const electronTrayPlatform: TrayPlatform<NativeImage, Menu> = {
  createImage: (buffer, options) =>
    nativeImage.createFromBuffer(buffer, options),
  createMenu: (rows) => Menu.buildFromTemplate(rows),
  createTray: (image) => new Tray(image),
  onMenuClose: (menu, listener) => {
    menu.on("menu-will-close", listener);
  },
  onMenuShow: (menu, listener) => {
    menu.on("menu-will-show", listener);
  },
};

const templateIcon = <Image extends TrayBitmap>(
  view: NativeView,
  createImage: (buffer: Buffer, options: { scaleFactor: number }) => Image
): Image => {
  const model = trayIconState(view);

  const image = createImage(trayIconPng(model, trayIconStandardScale), {
    scaleFactor: trayIconStandardScale,
  });

  if (image.isEmpty()) {
    throw new Error("Native calendar icon could not decode");
  }

  image.addRepresentation({
    buffer: trayIconPng(model, trayIconRetinaScale),
    scaleFactor: trayIconRetinaScale,
  });
  image.setTemplateImage(trayIconTemplate);

  return image;
};

const time = (
  value: number,
  preferences: typeof PromptPreferences.Type | undefined
) => {
  const timing: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    ...nativeLocaleOptions(preferences?.locale),
  };

  if (preferences?.locale !== undefined) {
    timing.hourCycle = preferences.timeFormat === "12" ? "h12" : "h23";
  }

  return DateTime.formatLocal(DateTime.makeUnsafe(value), timing);
};

const day = (value: number, locale: string | undefined) =>
  DateTime.formatLocal(DateTime.makeUnsafe(value), {
    day: "numeric",
    month: "short",
    weekday: "short",
    ...nativeLocaleOptions(locale),
  });

const nativeTrayItem = <Image extends TrayBitmap>(
  row: TrayMenuItem,
  createImage: (buffer: Buffer, options: { scaleFactor: number }) => Image
): TrayRow<Image> => {
  const { calendarColor, submenu, ...item } = row;

  const result: TrayRow<Image> = { ...item };

  if (calendarColor !== undefined) {
    result.icon = createImage(calendarDotPng(calendarColor), {
      scaleFactor: 2,
    });
  }

  if (submenu !== undefined) {
    result.submenu = submenu.map((child) => nativeTrayItem(child, createImage));
  }

  return result;
};

export const makeNativeTrayWith = Effect.fn("Desktop.makeNativeTray")(
  function* makeNativeTrayWith<Image extends TrayBitmap, MenuValue>(
    platform: TrayPlatform<Image, MenuValue>,
    intent: (value: NativeIntentValue) => void,
    menuState: (value: "open" | "closed") => void
  ) {
    const context = yield* Effect.context();
    const runSync = Effect.runSyncWith(context);

    const current = yield* Ref.make<
      Option.Option<TrayHandle<Image, MenuValue>>
    >(Option.none());

    const close = Effect.sync(() => {
      const value = runSync(Ref.get(current));
      runSync(Ref.set(current, Option.none()));

      if (Option.isSome(value) && !value.value.isDestroyed()) {
        value.value.destroy();
      }
    });

    yield* Effect.addFinalizer(() => close);

    const render = Effect.fn("Desktop.renderTray")(function* render(
      view: NativeView
    ) {
      if (!view.preferences.menuBar) {
        return yield* close;
      }

      const currentView = { ...view, now: yield* Clock.currentTimeMillis };

      return yield* Effect.try({
        catch: (cause) =>
          new DesktopError({ cause, message: "Menu bar could not update" }),
        try: () => {
          const previous = runSync(Ref.get(current));

          const image = templateIcon(currentView, platform.createImage);

          const tray =
            Option.isSome(previous) && !previous.value.isDestroyed()
              ? previous.value
              : platform.createTray(image);

          runSync(Ref.set(current, Option.some(tray)));
          tray.setImage(image);
          tray.setToolTip("Potion Calendar");

          const preferences = currentView.agenda.promptPreferences;

          const format = {
            day: (value: number) => day(value, preferences?.locale),
            time: (value: number) => time(value, preferences),
          };

          const rows = trayMenuRows(currentView, format, intent).map((row) =>
            nativeTrayItem(row, platform.createImage)
          );

          rows.push(
            { type: "separator" },
            {
              click: () => {
                intent(NativeIntent.cases.OpenWindow.make({}));
              },
              label: "Open Potion Calendar",
            },
            {
              click: () => {
                intent(
                  NativeIntent.cases.OpenSettings.make({ page: "menu-bar" })
                );
              },
              label: "Settings…",
            },
            {
              click: () => {
                intent(NativeIntent.cases.Quit.make({}));
              },
              label: "Quit Potion Calendar",
            }
          );
          const menu = platform.createMenu(rows);
          platform.onMenuShow(menu, () => {
            menuState("open");
          });
          platform.onMenuClose(menu, () => {
            menuState("closed");
          });
          tray.setContextMenu(menu);

          tray.setTitle(
            previewLabel(
              currentView.agenda,
              currentView.preferences,
              currentView.now,
              format.time
            )
          );
        },
      });
    });

    const toggle = (state: "open" | "closed") =>
      Effect.try({
        catch: (cause) =>
          new DesktopError({ cause, message: "Menu bar could not open" }),
        try: () => {
          const tray = runSync(Ref.get(current));

          if (Option.isSome(tray) && !tray.value.isDestroyed()) {
            if (state === "open") {
              tray.value.closeContextMenu();
            } else {
              tray.value.popUpContextMenu();
            }
          }
        },
      });

    return {
      active: Ref.get(current).pipe(
        Effect.map(
          (value) => Option.isSome(value) && !value.value.isDestroyed()
        )
      ),
      render,
      toggle,
    };
  }
);

export const makeNativeTray = (
  intent: (value: NativeIntentValue) => void,
  menuState: (value: "open" | "closed") => void
) => makeNativeTrayWith(electronTrayPlatform, intent, menuState);

export class NativeTray extends Context.Service<
  NativeTray,
  Effect.Success<ReturnType<typeof makeNativeTray>>
>()("@calendar/desktop/NativeTray") {
  static readonly layer = (
    intent: (value: NativeIntentValue) => void,
    menuState: (value: "open" | "closed") => void
  ) => Layer.effect(NativeTray, makeNativeTray(intent, menuState));
}

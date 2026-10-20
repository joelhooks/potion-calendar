import { Context, DateTime, Effect, Layer, Match, Option, Ref } from "effect";
import { Menu, Tray, nativeImage } from "electron";
import type { MenuItemConstructorOptions } from "electron";

import { menuAgenda, previewLabel, singleLine } from "./agenda.js";
import { DesktopError } from "./config.js";
import { NativeIntent } from "./native-host.js";
import type { NativeIntentValue, NativeView } from "./native-host.js";
import { calendarDotPng, iconPng } from "./tray-icon.js";

const calendarFrame = (x: number, y: number): boolean =>
  x >= 4 &&
  x <= 27 &&
  y >= 5 &&
  y <= 28 &&
  (x <= 6 || x >= 25 || y <= 7 || y >= 26 || y === 12);

const templateIcon = () => {
  const pixels = Buffer.alloc(32 * 32 * 4);

  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      const border = calendarFrame(x, y);

      const rings = (x === 10 || x === 21) && y >= 2 && y <= 9;
      const day = x >= 12 && x <= 19 && y >= 17 && y <= 22;

      if (border || rings || day) {
        pixels[(y * 32 + x) * 4 + 3] = 255;
      }
    }
  }

  const image = nativeImage.createFromBuffer(iconPng(pixels, 32, 32), {
    scaleFactor: 2,
  });

  if (image.isEmpty()) {
    throw new Error("Native calendar icon could not decode");
  }

  image.setTemplateImage(true);

  return image;
};

const time = (value: number) =>
  DateTime.formatLocal(DateTime.makeUnsafe(value), {
    hour: "numeric",
    minute: "2-digit",
  });

const day = (value: number) =>
  DateTime.formatLocal(DateTime.makeUnsafe(value), {
    day: "numeric",
    month: "short",
    weekday: "short",
  });

export const makeNativeTray = Effect.fn("Desktop.makeNativeTray")(
  function* makeNativeTray(
    intent: (value: NativeIntentValue) => void,
    menuState: (value: "open" | "closed") => void
  ) {
    const context = yield* Effect.context();
    const runSync = Effect.runSyncWith(context);
    const current = yield* Ref.make<Option.Option<Tray>>(Option.none());

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

      return yield* Effect.try({
        catch: (cause) =>
          new DesktopError({ cause, message: "Menu bar could not update" }),
        try: () => {
          const previous = runSync(Ref.get(current));

          const tray =
            Option.isSome(previous) && !previous.value.isDestroyed()
              ? previous.value
              : new Tray(templateIcon());

          runSync(Ref.set(current, Option.some(tray)));
          tray.setToolTip("Potion Calendar");
          const rows: MenuItemConstructorOptions[] = [];
          let group = "";

          for (const event of menuAgenda(
            view.agenda,
            view.preferences,
            view.now
          )) {
            const label = day(event.start);

            if (label !== group) {
              rows.push({ enabled: false, label });
              group = label;
            }

            const actions: MenuItemConstructorOptions[] = [
              {
                click: () => {
                  intent(NativeIntent.cases.ShowEvent.make({ key: event.key }));
                },
                label: "Show event",
              },
            ];

            if (event.conferenceUrl !== null) {
              const { conferenceUrl } = event;
              actions.unshift({
                click: () => {
                  intent(
                    NativeIntent.cases.Join.make({
                      request: { conferenceUrl, key: event.key },
                    })
                  );
                },
                label: "Join",
              });
            }

            const response = Match.value(event.responseStatus).pipe(
              Match.when("tentative", () => "Maybe · "),
              Match.when("needsAction", () => "Unanswered · "),
              Match.orElse(() => "")
            );

            rows.push({
              icon: nativeImage.createFromBuffer(
                calendarDotPng(event.calendarColor),
                { scaleFactor: 2 }
              ),
              label: `${event.allDay ? "All-day" : time(event.start)}  ${response}${singleLine(event.title)}`,
              submenu: actions,
            });
          }

          if (rows.length === 0) {
            rows.push({ enabled: false, label: "No upcoming meeting" });
          }

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
          const menu = Menu.buildFromTemplate(rows);
          menu.on("menu-will-show", () => {
            menuState("open");
          });
          menu.on("menu-will-close", () => {
            menuState("closed");
          });
          tray.setContextMenu(menu);

          tray.setTitle(
            previewLabel(view.agenda, view.preferences, view.now, time)
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

export class NativeTray extends Context.Service<
  NativeTray,
  Effect.Success<ReturnType<typeof makeNativeTray>>
>()("@calendar/desktop/NativeTray") {
  static readonly layer = (
    intent: (value: NativeIntentValue) => void,
    menuState: (value: "open" | "closed") => void
  ) => Layer.effect(NativeTray, makeNativeTray(intent, menuState));
}

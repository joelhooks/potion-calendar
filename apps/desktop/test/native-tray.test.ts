import type { AgendaEventValue } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { DateTime, Effect } from "effect";
import { TestClock } from "effect/testing";

import { makeNativeTrayWith } from "../src/native-tray.js";
import type { TrayHandle, TrayPlatform, TrayRow } from "../src/native-tray.js";
import { trayIconPng } from "../src/tray-icon.js";
import type { TrayIconState } from "../src/tray-icon.js";
import { trayEvent, trayView } from "./tray-current-fixture.js";

const makeImage = (buffer: Buffer, scale: number, empty: boolean) => {
  const representations = new Map<number, Buffer>([[scale, buffer]]);
  const templateFlags: boolean[] = [];

  return {
    addRepresentation: (options: { buffer: Buffer; scaleFactor: number }) => {
      representations.set(options.scaleFactor, options.buffer);
    },
    isEmpty: () => empty,
    representations,
    setTemplateImage: (value: boolean) => {
      templateFlags.push(value);
    },
    templateFlags,
  };
};

type Image = ReturnType<typeof makeImage>;

const makeMenu = (rows: readonly TrayRow<Image>[]) => {
  const callbacks = new Map<"menu-will-show" | "menu-will-close", () => void>();

  return {
    callbacks,
    on: (event: "menu-will-show" | "menu-will-close", listener: () => void) => {
      callbacks.set(event, listener);
    },
    rows,
  };
};

type Menu = ReturnType<typeof makeMenu>;

class Tray implements TrayHandle<Image, Menu> {
  readonly initial: Image;
  readonly images: Image[] = [];
  readonly menus: Menu[] = [];
  readonly titles: string[] = [];
  readonly tooltips: string[] = [];
  destroyed = false;
  opened = 0;
  closed = 0;

  constructor(image: Image) {
    this.initial = image;
  }

  isDestroyed = () => this.destroyed;
  destroy = () => {
    this.destroyed = true;
  };
  setImage = (image: Image) => {
    this.images.push(image);
  };
  setContextMenu = (menu: Menu) => {
    this.menus.push(menu);
  };
  setTitle = (value: string) => {
    this.titles.push(value);
  };
  setToolTip = (value: string) => {
    this.tooltips.push(value);
  };
  closeContextMenu = () => {
    this.closed += 1;
  };
  popUpContextMenu = () => {
    this.opened += 1;
  };
}

const harness = Effect.fn("TrayTest.harness")(function* harness(
  empty: boolean
) {
  const trays: Tray[] = [];
  const menus: Menu[] = [];
  const states: string[] = [];

  const platform: TrayPlatform<Image, Menu> = {
    createImage: (buffer, options) =>
      makeImage(buffer, options.scaleFactor, empty),
    createMenu: (rows) => {
      const menu = makeMenu(rows);
      menus.push(menu);

      return menu;
    },
    createTray: (image) => {
      const tray = new Tray(image);
      trays.push(tray);

      return tray;
    },
    onMenuClose: (menu, listener) => {
      menu.callbacks.set("menu-will-close", listener);
    },
    onMenuShow: (menu, listener) => {
      menu.callbacks.set("menu-will-show", listener);
    },
  };

  const native = yield* makeNativeTrayWith(
    platform,
    () => {},
    (state) => {
      states.push(state);
    }
  );

  return { menus, native, states, trays };
});

const localNoon = DateTime.toEpochMillis(
  DateTime.makeZonedUnsafe(
    { day: 28, hour: 12, month: 5, year: 2028 },
    { adjustForTimeZone: true, timeZone: DateTime.zoneMakeLocal() }
  )
);

const responses: readonly {
  response: NonNullable<AgendaEventValue["rsvp"]>["response"];
  mark: TrayIconState["mark"];
}[] = [
  { mark: "accepted", response: "accepted" },
  { mark: "tentative", response: "tentative" },
  { mark: "unanswered", response: "needsAction" },
  { mark: "unanswered", response: null },
  { mark: "date-only", response: "declined" },
];

it.effect(
  "the real render path replaces both template representations without replacing the Tray",
  () =>
    Effect.gen(function* imageryHistory() {
      yield* TestClock.setTime(localNoon);
      const { native, trays } = yield* harness(false);

      const event = {
        ...trayEvent("current"),
        end: localNoon + 172_800_000,
        start: localNoon - 1000,
      };

      let count = 0;

      for (const { response, mark } of responses) {
        yield* native.render({
          ...trayView([
            {
              ...event,
              responseStatus: "accepted",
              rsvp: { enabled: true, response },
            },
          ]),
          now: 0,
        });
        count += 1;
        expect(trays).toHaveLength(1);
        const [tray] = trays;
        expect(tray?.images).toHaveLength(count);
        const image = tray?.images.at(-1);
        expect(image?.templateFlags).toEqual([true]);
        expect([...(image?.representations.keys() ?? [])]).toEqual([1, 2]);
        expect(image?.representations.get(1)).toEqual(
          trayIconPng({ day: 28, mark }, 1)
        );
        expect(image?.representations.get(2)).toEqual(
          trayIconPng({ day: 28, mark }, 2)
        );
      }

      const [tray] = trays;

      for (const scale of [1, 2]) {
        const images = tray?.images.map((image) =>
          image.representations.get(scale)?.toString("base64")
        );

        expect(new Set(images).size).toBe(4);
      }

      yield* TestClock.adjust(86_400_000);
      yield* native.render(trayView([]));
      expect(trays).toHaveLength(1);
      expect(trays[0]?.images.at(-1)?.representations.get(1)).toEqual(
        trayIconPng({ day: 29, mark: "date-only" }, 1)
      );
    })
);

it.effect(
  "menu colors, footer actions, menu state and resource disposal survive image replacement",
  () =>
    Effect.gen(function* menuHistory() {
      yield* TestClock.setTime(localNoon);

      const result = yield* Effect.scoped(
        Effect.gen(function* ownedTray() {
          const state = yield* harness(false);
          yield* state.native.render(
            trayView([
              {
                ...trayEvent("current"),
                end: localNoon + 60_000,
                start: localNoon,
              },
            ])
          );
          expect(yield* state.native.active).toBe(true);
          const [menu] = state.menus;
          expect(menu?.rows.slice(-3).map((row) => row.label)).toEqual([
            "Open Potion Calendar",
            "Settings…",
            "Quit Potion Calendar",
          ]);

          const colored = menu?.rows.find(
            (row) => row.icon !== undefined
          )?.icon;

          expect(colored?.templateFlags).toEqual([]);
          expect(colored?.representations.get(2)?.readUInt32BE(16)).toBe(16);
          menu?.callbacks.get("menu-will-show")?.();
          menu?.callbacks.get("menu-will-close")?.();
          expect(state.states).toEqual(["open", "closed"]);
          yield* state.native.toggle("closed");
          yield* state.native.toggle("open");
          expect(state.trays[0]?.opened).toBe(1);
          expect(state.trays[0]?.closed).toBe(1);

          return state;
        })
      );

      expect(result.trays[0]?.destroyed).toBe(true);
    })
);

it.effect(
  "disabling the menu closes the owned tray and re-enabling derives a fresh image",
  () =>
    Effect.gen(function* visibilityHistory() {
      yield* TestClock.setTime(localNoon);
      const { native, trays } = yield* harness(false);
      const view = trayView([]);
      yield* native.render(view);
      yield* native.render({
        ...view,
        preferences: { ...view.preferences, menuBar: false },
      });
      expect(yield* native.active).toBe(false);
      expect(trays[0]?.destroyed).toBe(true);
      yield* TestClock.adjust(86_400_000);
      yield* native.render(view);
      expect(trays).toHaveLength(2);
      expect(trays[1]?.images[0]?.representations.get(1)).toEqual(
        trayIconPng({ day: 29, mark: "date-only" }, 1)
      );
    })
);

it.effect("an empty decoded native image fails before creating a tray", () =>
  Effect.gen(function* decodingFailure() {
    const { native, trays } = yield* harness(true);
    const failure = yield* native.render(trayView([])).pipe(Effect.flip);
    expect(failure.message).toBe("Menu bar could not update");
    expect(trays).toHaveLength(0);
    expect(yield* native.active).toBe(false);
  })
);

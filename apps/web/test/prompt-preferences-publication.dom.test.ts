import {
  AgendaSnapshot,
  defaultDesktopPreferences,
} from "@calendar/core/desktop-bridge";
import type { AgendaSnapshotValue } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Layer, Schema, Stream } from "effect";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import { DesktopNotice } from "../src/client/desktop/model.js";
import { EditingRuntime } from "../src/client/editing/runtime.js";
import { SettingsChange } from "../src/client/settings/model.js";
import { subscriptions } from "../src/client/subscriptions.js";
import { unusedBrowserLayers } from "./browser-runtime-fixture.js";
import { upcomingFixture } from "./upcoming-fixture.js";

const unusedEditing = Effect.die(
  "Prompt preference publication must not edit events"
);

const domainFence = Layer.mergeAll(
  unusedBrowserLayers,
  Layer.succeed(
    EditingRuntime,
    EditingRuntime.of({
      connect: () => unusedEditing,
      dispatch: () => unusedEditing,
    })
  )
);

it.effect(
  "actual root preference and native settings messages change the desktop publication immediately without changing events",
  () =>
    Effect.gen(function* rootPreferencePublication() {
      const published: AgendaSnapshotValue[] = [];

      const descriptor = Object.getOwnPropertyDescriptor(
        window,
        "potionDesktop"
      );

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          Object.defineProperty(window, "potionDesktop", {
            configurable: true,
            value: {
              publishAgenda: (snapshot: AgendaSnapshotValue) => {
                published.push(snapshot);
              },
            },
          });
        }),
        () =>
          Effect.sync(() => {
            if (descriptor === undefined) {
              Reflect.deleteProperty(window, "potionDesktop");
            } else {
              Object.defineProperty(window, "potionDesktop", descriptor);
            }
          })
      );
      const timer = vi.spyOn(window, "setInterval");
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          timer.mockRestore();
        })
      );

      let { model } = update(
        upcomingFixture(),
        Message.ReceivedDesktop({
          notice: DesktopNotice.cases.Settings.make({
            settings: {
              issues: [],
              openAtLogin: false,
              preferences: defaultDesktopPreferences(),
              revision: 1,
            },
          }),
        })
      );

      const publish = () =>
        subscriptions.desktopAgenda
          .dependenciesToStream(
            subscriptions.desktopAgenda.modelToDependencies(model)
          )
          .pipe(Stream.runDrain);

      yield* publish();

      for (const theme of ["light", "dark", "auto"] satisfies readonly (
        | "light"
        | "dark"
        | "auto"
      )[]) {
        ({ model } = update(
          model,
          Message.ChangedSettings({
            change: SettingsChange.cases.Theme.make({ value: theme }),
          })
        ));

        for (const hour24 of [false, true]) {
          ({ model } = update(
            model,
            Message.ReceivedSystemSettings({ dark: true, hour24 })
          ));

          for (const timeFormat of ["12", "24", "system"] satisfies readonly (
            | "12"
            | "24"
            | "system"
          )[]) {
            ({ model } = update(
              model,
              Message.ChangedSettings({
                change: SettingsChange.cases.TimeFormat.make({
                  value: timeFormat,
                }),
              })
            ));
            const before = published.at(-1);

            const dependencies =
              subscriptions.desktopAgenda.modelToDependencies(model);

            expect(
              Schema.decodeOption(AgendaSnapshot)(dependencies.snapshot)._tag
            ).toBe("Some");
            yield* publish();
            const systemFormat = hour24 ? "24" : "12";

            expect(published.at(-1)?.promptPreferences).toEqual({
              joinShortcut: defaultDesktopPreferences().joinShortcut,
              placement: { anchor: "topCenter", display: "cursor" },
              theme: theme === "auto" ? "dark" : theme,
              timeFormat: timeFormat === "system" ? systemFormat : timeFormat,
              version: 1,
            });
            expect(published.at(-1)?.events).toEqual(before?.events);
          }
        }
      }

      let revision = 1;

      for (const joinShortcut of ["Ctrl+Alt+K", null]) {
        revision += 1;
        ({ model } = update(
          model,
          Message.ReceivedDesktop({
            notice: DesktopNotice.cases.Settings.make({
              settings: {
                issues: [],
                openAtLogin: false,
                preferences: { ...defaultDesktopPreferences(), joinShortcut },
                revision,
              },
            }),
          })
        ));
        yield* publish();
        expect(published.at(-1)?.promptPreferences?.joinShortcut).toBe(
          joinShortcut
        );
      }

      expect(timer).not.toHaveBeenCalled();
    }).pipe(Effect.scoped, Effect.provide(domainFence))
);

import type {
  AgendaSnapshotValue,
  DesktopSettingsValue,
} from "@calendar/core/desktop-bridge";
import { Effect, Option, Stream } from "effect";
import { AsyncData } from "foldkit";

import { resolvedTimeFormat } from "../../layout/time-format.js";
import type { AppModel } from "../app.js";
import { Message } from "../message.js";
import { nativeNotificationAgenda } from "../reminders/native-projection.js";
import { resolvedTheme } from "../settings/model.js";
import { browserDesktop } from "./commands.js";
import { DesktopBridgeError } from "./io.js";
import { DesktopNotice } from "./model.js";
import { desktopNoticeStream } from "./runtime.js";
import { agendaSnapshot } from "./snapshot.js";

const promptPreferences = (
  model: AppModel,
  settings?: DesktopSettingsValue
): NonNullable<AgendaSnapshotValue["promptPreferences"]> => ({
  joinShortcut: settings?.preferences.joinShortcut ?? null,
  placement: { anchor: "topCenter", display: "cursor" },
  theme: resolvedTheme(model),
  timeFormat: resolvedTimeFormat(model),
  version: 1,
});

export const desktopDependencies = (model: AppModel) => {
  const notificationAgenda = nativeNotificationAgenda(model);

  const snapshot = Option.match(AsyncData.getData(model.desktop.settings), {
    onNone: (): AgendaSnapshotValue => ({
      events: [],
      promptPreferences: promptPreferences(model),
    }),
    onSome: (settings): AgendaSnapshotValue => ({
      ...agendaSnapshot(
        model,
        settings.preferences,
        typeof window === "undefined" ? undefined : window.location.origin
      ),
      promptPreferences: promptPreferences(model, settings),
    }),
  });

  return {
    active: model.desktop.availability === "available",
    snapshot:
      notificationAgenda === undefined
        ? snapshot
        : { ...snapshot, notificationAgenda },
  };
};

export const desktopAgendaStream = (
  active: boolean,
  snapshot: AgendaSnapshotValue
) =>
  active
    ? Stream.fromEffectDrain(
        Effect.try({
          catch: () =>
            new DesktopBridgeError({
              message: "The desktop agenda could not be updated.",
            }),
          try: () => {
            const bridge = browserDesktop();

            if (Option.isSome(bridge)) {
              bridge.value.publishAgenda(snapshot);
            }
          },
        })
      ).pipe(
        Stream.catchTag("DesktopBridgeError", (problem) =>
          Stream.succeed(
            Message.ReceivedDesktop({
              notice: DesktopNotice.cases.Rejected.make({
                message: problem.message,
              }),
            })
          )
        )
      )
    : Stream.empty;

export const desktopActionStream = () =>
  Stream.suspend(() => desktopNoticeStream(browserDesktop())).pipe(
    Stream.map((notice) => Message.ReceivedDesktop({ notice }))
  );

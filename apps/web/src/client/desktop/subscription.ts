import type { AgendaSnapshotValue } from "@calendar/core/desktop-bridge";
import { Effect, Option, Stream } from "effect";
import { AsyncData } from "foldkit";

import type { AppModel } from "../app.js";
import { Message } from "../message.js";
import { browserDesktop } from "./commands.js";
import { DesktopBridgeError } from "./io.js";
import { DesktopNotice } from "./model.js";
import { desktopNoticeStream } from "./runtime.js";
import { agendaSnapshot } from "./snapshot.js";

export const desktopDependencies = (model: AppModel) => ({
  active: model.desktop.availability === "available",
  snapshot: Option.match(AsyncData.getData(model.desktop.settings), {
    onNone: (): AgendaSnapshotValue => ({ events: [] }),
    onSome: (settings) =>
      agendaSnapshot(
        model,
        settings.preferences,
        typeof window === "undefined" ? undefined : window.location.origin
      ),
  }),
});

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

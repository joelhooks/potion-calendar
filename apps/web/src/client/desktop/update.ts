import type { DesktopSettingsValue } from "@calendar/core/desktop-bridge";
import { Match, Option } from "effect";
import { AsyncData } from "foldkit";

import { RemoteDesktop } from "./model.js";
import type { DesktopNotice, DesktopUi } from "./model.js";

type DesktopState = typeof DesktopUi.Type;

const currentRevision = (state: DesktopState): number =>
  Option.match(AsyncData.getData(state.settings), {
    onNone: () => -1,
    onSome: (settings) => settings.revision,
  });

export const beginDesktopRequest = (state: DesktopState): DesktopState => ({
  ...state,
  error: Option.none(),
  request: state.request + 1,
  settings: Option.match(AsyncData.getData(state.settings), {
    onNone: () => RemoteDesktop.Loading(),
    onSome: (data) => RemoteDesktop.Refreshing({ data }),
  }),
});

const observedSettings = (
  state: DesktopState,
  settings: DesktopSettingsValue
): DesktopState =>
  settings.revision > currentRevision(state)
    ? {
        ...state,
        availability: "available",
        error: Option.none(),
        settings: RemoteDesktop.Success({ data: settings }),
      }
    : state;

export const receiveDesktopNotice = (
  state: DesktopState,
  notice: typeof DesktopNotice.Type
): DesktopState =>
  Match.value(notice).pipe(
    Match.tagsExhaustive({
      Action: () => state,
      Finished: (finished) =>
        finished.request === state.request
          ? Match.value(finished.outcome).pipe(
              Match.tagsExhaustive({
                Failed: ({ message }): DesktopState => ({
                  ...state,
                  availability: "available",
                  canSaveIcs: finished.canSaveIcs ?? state.canSaveIcs ?? false,
                  error: Option.some(message),
                  settings: Option.match(AsyncData.getData(state.settings), {
                    onNone: () => RemoteDesktop.Failure({ error: message }),
                    onSome: (data) =>
                      RemoteDesktop.Stale({ data, error: message }),
                  }),
                }),
                Ready: ({ error, settings }): DesktopState =>
                  settings.revision < currentRevision(state)
                    ? state
                    : {
                        ...state,
                        availability: "available",
                        canSaveIcs:
                          finished.canSaveIcs ?? state.canSaveIcs ?? false,
                        error,
                        settings: RemoteDesktop.Success({ data: settings }),
                      },
                Unavailable: (): DesktopState => ({
                  ...state,
                  availability: "unavailable",
                  canSaveIcs: false,
                  error: Option.none(),
                  settings: RemoteDesktop.Idle(),
                }),
              })
            )
          : state,
      Rejected: ({ message }) => ({ ...state, error: Option.some(message) }),
      Settings: ({ settings }) => observedSettings(state, settings),
    })
  );

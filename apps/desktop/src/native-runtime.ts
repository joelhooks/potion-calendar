// @effect-diagnostics-next-line nodeBuiltinImport:off -- This composition root supplies the native writer only to the user-dialog-authorized ICS save service.
import { writeFile } from "node:fs/promises";

import {
  DesktopAction,
  desktopChannels,
  desktopWire,
  eligiblePromptAttachments,
} from "@calendar/core/desktop-bridge";
import type {
  AgendaKeyValue,
  DesktopActionValue,
  DesktopSettingsValue,
  MeetingJoinRequestValue,
} from "@calendar/core/desktop-bridge";
import { send } from "@xstate/effect";
import {
  Clock,
  Context,
  Effect,
  Fiber,
  Layer,
  Match,
  Option,
  Predicate,
  Ref,
  Schema,
  Stream,
} from "effect";
import { app, dialog, ipcMain, shell } from "electron";
import type { BrowserWindow } from "electron";

import { acceptsDesktopFrame } from "./bridge-policy.js";
import { DesktopError } from "./config.js";
import { IcsFileSaver } from "./ics-save.js";
import { mainWindowActions } from "./main-window.js";
import { NativeIntent, startNativeHost } from "./native-host.js";
import type { NativeIntentValue } from "./native-host.js";
import { nativeIcsSavePort } from "./native-ics-save.js";
import { NativeIntentEvent } from "./native-intent-event.js";
import { runNativeJoin } from "./native-join.js";
import { nativeSettingsPort } from "./native-settings.js";
import { NativeTray } from "./native-tray.js";
import { navigation as classifyNavigation } from "./navigation.js";
import { promptActionIntent } from "./prompt-action.js";
import {
  emailPromptParticipants,
  openPromptAttachment,
  requestPromptSnooze,
} from "./prompt-actions.js";
import { startPrompt } from "./prompt-machine.js";
import { PromptWindow } from "./prompt-window.js";
import { NativeSettings } from "./settings.js";
import { soundPreviewEnabled } from "./sound-machine.js";
import { performTrayAction } from "./tray-actions.js";

export const makeDesktopRuntime = Effect.fn("Desktop.makeDesktopRuntime")(
  function* makeDesktopRuntime(
    window: BrowserWindow,
    origin: string,
    focus: () => void,
    events: EventTarget
  ) {
    const context = yield* Effect.context();
    const scope = yield* Effect.scope;
    const runPromise = Effect.runPromiseWith(context);
    const runFork = Effect.runForkWith(context);

    const navigationStartedAt = yield* Ref.make<Option.Option<number>>(
      Option.none()
    );

    const intent = (value: NativeIntentValue) => {
      events.dispatchEvent(new NativeIntentEvent(value));
    };

    const settings = yield* NativeSettings;

    yield* settings.get.pipe(
      Effect.catch(() =>
        Effect.logWarning("macOS login-item status could not be read at launch")
      )
    );
    const preferences = yield* settings.preferences;
    const now = yield* Clock.currentTimeMillis;

    const promptWindow = yield* PromptWindow;

    const prompt = yield* startPrompt(promptWindow, {
      now,
      preferences,
      snapshot: { events: [] },
    });

    const tray = yield* NativeTray;

    const pageAction = (action: DesktopActionValue) =>
      Effect.try({
        catch: (cause) =>
          new DesktopError({
            cause,
            message: "Open Potion Calendar before using this action",
          }),
        try: () => {
          if (
            window.isDestroyed() ||
            !acceptsDesktopFrame(origin, window.webContents.getURL(), true)
          ) {
            throw new Error("Calendar is unavailable");
          }

          const value = Schema.encodeOption(desktopWire.action)(action);

          if (Option.isNone(value)) {
            throw new Error("Invalid desktop action");
          }

          window.webContents.send(desktopChannels.action, value.value);
        },
      });

    const windowActions = mainWindowActions(focus, pageAction);

    const openExternal = (url: string) =>
      classifyNavigation(url, origin) === "browser"
        ? Effect.tryPromise({
            catch: (cause) =>
              new DesktopError({
                cause,
                message: "The meeting could not be opened",
              }),
            // @effect-diagnostics-next-line asyncFunction:off -- Electron's external URL opener is an accepted OS handoff, not a completed conference join.
            try: async () => {
              await shell.openExternal(url);
            },
          })
        : Effect.fail(
            new DesktopError({ message: "External URL is not permitted" })
          );

    const join = Effect.fn("Desktop.joinMeeting")(function* join(
      request: MeetingJoinRequestValue
    ) {
      const result = yield* runNativeJoin(request, openExternal);

      if (Predicate.isTagged(result, "Requested")) {
        yield* send(prompt, { key: request.key, type: "Dismiss" });
      }

      return result;
    });

    const joinWithFeedback = (request: MeetingJoinRequestValue) =>
      join(request).pipe(
        Effect.tap((result) =>
          Predicate.isTagged(result, "Failed")
            ? Effect.sync(() => {
                dialog.showErrorBox("Could not open meeting", result.message);
              })
            : Effect.void
        ),
        Effect.asVoid
      );

    const showEvent = (key: AgendaKeyValue) =>
      Effect.sync(focus).pipe(
        Effect.andThen(pageAction(DesktopAction.cases.ShowEvent.make({ key }))),
        Effect.andThen(send(prompt, { key, type: "Dismiss" }))
      );

    const trayActionPort = {
      join: joinWithFeedback,
      open: openExternal,
      origin,
      show: showEvent,
      trusted: Effect.sync(
        () =>
          !window.isDestroyed() &&
          acceptsDesktopFrame(origin, window.webContents.getURL(), true)
      ),
    };

    const host = yield* startNativeHost(
      {
        intents: Stream.fromEventListener<NativeIntentEvent>(
          events,
          "intent"
        ).pipe(Stream.map((event) => event.intent)),
        perform: (action, view) =>
          Match.value(action).pipe(
            Match.tagsExhaustive({
              ClosedPrompt: () => send(prompt, { type: "Closed" }),
              DismissPrompt: (value) =>
                send(prompt, { key: value.key, type: "Dismiss" }),
              EmailPrompt: (value) =>
                emailPromptParticipants(value.key, view.agenda, openExternal),
              Join: (value) => joinWithFeedback(value.request),
              MenuState: () => Effect.void,
              OpenPromptAttachment: (value) =>
                openPromptAttachment(
                  {
                    action: "attachment",
                    index: value.index,
                    key: value.key,
                    url: value.url,
                  },
                  view.agenda,
                  openExternal
                ),
              OpenSettings: (value) => windowActions.settings(value.page),
              OpenWindow: () => windowActions.open(),
              Quit: () =>
                Effect.sync(() => {
                  app.quit();
                }),
              RequestedJoinMeeting: () =>
                pageAction(DesktopAction.cases.RequestedJoinMeeting.make({})),
              RespondToEvent: (value) =>
                pageAction(
                  DesktopAction.cases.RespondToEvent.make({
                    key: value.key,
                    response: value.response,
                  })
                ).pipe(
                  Effect.tapError((failure) =>
                    Effect.sync(() => {
                      dialog.showErrorBox("Could not respond", failure.message);
                    })
                  )
                ),
              ShowEvent: (value) => showEvent(value.key),
              SnoozePrompt: (value) => requestPromptSnooze(prompt, value.key),
              Stop: () => Effect.void,
              ToggleMenu: () => tray.toggle(view.menuState),
              TrayAttachment: (value) =>
                performTrayAction(value, view, trayActionPort),
              TrayEmail: (value) =>
                performTrayAction(value, view, trayActionPort),
              TrayJoin: (value) =>
                performTrayAction(value, view, trayActionPort),
              TrayShowEvent: (value) =>
                performTrayAction(value, view, trayActionPort),
            }),
            Effect.tapError(() =>
              Effect.logWarning("Desktop native action failed")
            )
          ),
        render: (view) =>
          tray.render(view).pipe(
            Effect.andThen(
              send(prompt, {
                now: view.now,
                preferences: view.preferences,
                snapshot: view.agenda,
                type: "Input",
              })
            ),
            Effect.tapError(() =>
              Effect.logWarning("Desktop native view failed")
            )
          ),
      },
      { now, preferences }
    );

    const trusted = (
      event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent
    ) =>
      !window.isDestroyed() &&
      event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame &&
      acceptsDesktopFrame(origin, event.senderFrame?.url ?? "", true);

    // @effect-diagnostics-next-line asyncFunction:off -- Electron awaits native Promises; request work remains in the owned Effect scope.
    const run = async <A, E>(task: Effect.Effect<A, E>): Promise<A> =>
      await runPromise(
        task.pipe(
          Effect.forkIn(scope),
          Effect.flatMap(Fiber.join),
          Effect.mapError(
            () => new DesktopError({ message: "Desktop request failed" })
          )
        )
      );

    const publishSettings = (value: DesktopSettingsValue) =>
      send(host.actor, { settings: value, type: "Settings" }).pipe(
        Effect.andThen(
          Effect.sync(() => {
            if (
              !window.isDestroyed() &&
              acceptsDesktopFrame(origin, window.webContents.getURL(), true)
            ) {
              const message = Schema.encodeOption(desktopWire.settings)(value);

              if (Option.isSome(message)) {
                window.webContents.send(
                  desktopChannels.settingsChanged,
                  message.value
                );
              }
            }
          })
        )
      );

    const saveIcs = yield* IcsFileSaver;

    ipcMain.handle(
      desktopChannels.saveIcs,
      // @effect-diagnostics-next-line asyncFunction:off -- The bounded native handler owns decoding, frame revalidation, dialog lifetime and the write result inside this window's Effect scope.
      async (event, payload): Promise<string> =>
        await run(
          saveIcs.handle(
            payload,
            Effect.sync(() => trusted(event))
          )
        )
    );

    const register = <A, B>(
      channel: string,
      input: Schema.Codec<A, string>,
      output: Schema.Codec<B, string>,
      operation: (value: A) => Effect.Effect<B, DesktopError>
    ) => {
      // @effect-diagnostics-next-line asyncFunction:off -- Electron's invoke handler receives a Schema-encoded JSON-text Promise.
      ipcMain.handle(channel, async (event, payload): Promise<string> => {
        if (!trusted(event)) {
          throw new Error("Denied desktop request");
        }

        return await run(
          Schema.decodeUnknownEffect(input)(payload).pipe(
            Effect.mapError(
              (cause) =>
                new DesktopError({ cause, message: "Invalid desktop payload" })
            ),
            Effect.flatMap(operation),
            Effect.flatMap(Schema.encodeEffect(output))
          )
        );
      });
    };

    ipcMain.handle(
      desktopChannels.settings,
      // @effect-diagnostics-next-line asyncFunction:off -- The no-argument settings endpoint adapts Electron's native Promise contract.
      async (event, payload): Promise<string> => {
        if (!trusted(event)) {
          throw new Error("Denied desktop request");
        }

        return await run(
          Schema.decodeUnknownEffect(Schema.Undefined)(payload).pipe(
            Effect.andThen(
              Effect.gen(function* observedSettings() {
                const value = yield* settings.get;

                return {
                  ...value,
                  runtime: {
                    navigationStartedAt: Option.getOrUndefined(
                      yield* Ref.get(navigationStartedAt)
                    ),
                    prompt: yield* promptWindow.active,
                    tray: yield* tray.active,
                  },
                };
              })
            ),
            Effect.tap(publishSettings),
            Effect.flatMap(Schema.encodeEffect(desktopWire.settings))
          )
        );
      }
    );
    register(
      desktopChannels.join,
      desktopWire.join,
      desktopWire.joinReply,
      join
    );
    register(
      desktopChannels.preferences,
      desktopWire.preferences,
      desktopWire.reply,
      (value) =>
        settings
          .save(value)
          .pipe(Effect.tap((reply) => publishSettings(reply.settings)))
    );
    register(
      desktopChannels.previewSound,
      desktopWire.previewSound,
      desktopWire.previewSoundReply,
      ({ sound }) =>
        promptWindow.preview(
          sound,
          settings.preferences.pipe(
            Effect.map((current) => soundPreviewEnabled(current, sound))
          )
        )
    );
    register(
      desktopChannels.startup,
      desktopWire.startup,
      desktopWire.reply,
      (value) =>
        settings
          .startup(value.enabled)
          .pipe(Effect.tap((reply) => publishSettings(reply.settings)))
    );

    const agenda: Parameters<typeof ipcMain.on>[1] = (event, value) => {
      if (!trusted(event)) {
        return;
      }

      const decoded = Schema.decodeUnknownOption(desktopWire.agenda)(value);

      if (Option.isSome(decoded)) {
        runFork(
          send(host.actor, {
            snapshot: {
              events: decoded.value.events.map((item) => ({
                ...item,
                attachments: eligiblePromptAttachments(
                  item.attachments ?? [],
                  origin
                ),
              })),
            },
            type: "Agenda",
          }).pipe(Effect.forkIn(scope))
        );
      } else {
        runFork(
          send(host.actor, { snapshot: { events: [] }, type: "Agenda" }).pipe(
            Effect.andThen(
              Effect.logWarning("Rejected desktop agenda payload")
            ),
            Effect.forkIn(scope)
          )
        );
      }
    };

    ipcMain.on(desktopChannels.agenda, agenda);

    const clear = () =>
      runFork(
        send(host.actor, { snapshot: { events: [] }, type: "Agenda" }).pipe(
          Effect.forkIn(scope)
        )
      );

    const navigation = () => {
      clear();
    };

    const onNavigation = (
      _event: Electron.Event,
      _url: string,
      isInPlace: boolean,
      isMainFrame: boolean
    ) => {
      if (isMainFrame && !isInPlace) {
        const startedAt = performance.timeOrigin + performance.now();
        runFork(
          Ref.update(navigationStartedAt, (previous) =>
            Option.isSome(previous) ? previous : Option.some(startedAt)
          ).pipe(Effect.forkIn(scope))
        );
        clear();
      }
    };

    const stop = () => {
      intent(NativeIntent.cases.Stop.make({}));
    };

    app.once("before-quit", stop);
    window.webContents.on("did-start-navigation", onNavigation);
    window.webContents.on("render-process-gone", navigation);
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        app.removeListener("before-quit", stop);
        window.webContents.removeListener("did-start-navigation", onNavigation);
        window.webContents.removeListener("render-process-gone", navigation);
        ipcMain.removeListener(desktopChannels.agenda, agenda);

        for (const channel of [
          desktopChannels.settings,
          desktopChannels.join,
          desktopChannels.preferences,
          desktopChannels.previewSound,
          desktopChannels.saveIcs,
          desktopChannels.startup,
        ]) {
          ipcMain.removeHandler(channel);
        }
      })
    );

    return { done: host.done, intent };
  }
);

export class DesktopRuntime extends Context.Service<
  DesktopRuntime,
  Effect.Success<ReturnType<typeof makeDesktopRuntime>>
>()("@calendar/desktop/Runtime") {
  static readonly layer = (
    window: BrowserWindow,
    origin: string,
    focus: () => void
  ) =>
    Layer.unwrap(
      Effect.sync(() => {
        const events = new EventTarget();

        const intent = (value: NativeIntentValue) => {
          events.dispatchEvent(new NativeIntentEvent(value));
        };

        return Layer.effect(
          DesktopRuntime,
          makeDesktopRuntime(window, origin, focus, events)
        ).pipe(
          Layer.provide(
            Layer.mergeAll(
              IcsFileSaver.layer(
                nativeIcsSavePort({
                  // @effect-diagnostics-next-line asyncFunction:off -- The composition root binds the dialog to this exact owned BrowserWindow.
                  choose: async (options) =>
                    await dialog.showSaveDialog(window, options),
                  // @effect-diagnostics-next-line asyncFunction:off -- Only the dialog-authorized service receives this native filesystem writer.
                  write: async (path, bytes, options) => {
                    await writeFile(path, bytes, options);
                  },
                })
              ),
              NativeSettings.layer(
                nativeSettingsPort((action) => {
                  intent(
                    action === "menu"
                      ? NativeIntent.cases.ToggleMenu.make({})
                      : NativeIntent.cases.RequestedJoinMeeting.make({})
                  );
                })
              ),
              NativeTray.layer(intent, (value) => {
                intent(NativeIntent.cases.MenuState.make({ value }));
              }),
              PromptWindow.layer(
                (action, event) => {
                  const value = promptActionIntent(action, event);

                  if (value !== undefined) {
                    intent(value);
                  }
                },
                () => {
                  intent(NativeIntent.cases.ClosedPrompt.make({}));
                }
              )
            )
          )
        );
      })
    );
}

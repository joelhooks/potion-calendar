import {
  aboutWire,
  IcsSaveOutcome,
  MeetingJoinOutcome,
  desktopWire,
  icsSaveParseOptions,
  nativeNotificationWire,
  NativeNotificationRequest,
  NotificationSettingsRequest,
  notificationSettingsWire,
  notificationSettingsReplyMatches,
} from "@calendar/core/desktop-bridge";
import type {
  DesktopBridge,
  IcsSaveRequest,
  NativeNotificationNotice,
} from "@calendar/core/desktop-bridge";
import { Option, Schema } from "effect";

export interface RendererBridgePort {
  readonly showAbout?: (message: string) => Promise<string>;
  readonly notificationSettings?: (message: string) => Promise<string>;
  readonly nativeNotifications?: (message: string) => Promise<string>;
  readonly subscribeNativeNotifications?: (
    receive: (message: string) => void
  ) => () => void;
  readonly getSettings: () => Promise<string>;
  readonly joinMeeting: (message: string) => Promise<string>;
  readonly previewSound?: (message: string) => Promise<string>;
  readonly publishAgenda: (message: string) => void;
  readonly rejected: () => void;
  readonly saveIcs?: (message: string) => Promise<string>;
  readonly savePreferences: (message: string) => Promise<string>;
  readonly setStartup: (message: string) => Promise<string>;
  readonly subscribeActions: (receive: (message: string) => void) => () => void;
  readonly subscribeSettings: (
    receive: (message: string) => void
  ) => () => void;
}

export const createDesktopBridge = (
  port: RendererBridgePort
): DesktopBridge => {
  const { saveIcs } = port;

  const decode = <A>(
    schema: Schema.Codec<A, string>,
    message: string
  ): Option.Option<A> => {
    const result = Schema.decodeOption(schema)(message);

    if (Option.isNone(result)) {
      port.rejected();
    }

    return result;
  };

  const encode = <A>(
    schema: Schema.Codec<A, string>,
    value: A
  ): Option.Option<string> => {
    const result = Schema.encodeOption(schema)(value);

    if (Option.isNone(result)) {
      port.rejected();
    }

    return result;
  };

  const reply = <A>(schema: Schema.Codec<A, string>, message: string): A => {
    const result = decode(schema, message);

    if (Option.isNone(result)) {
      throw new Error("Invalid desktop reply");
    }

    return result.value;
  };

  const { nativeNotifications } = port;
  const { subscribeNativeNotifications } = port;

  const exposeNative = (base: DesktopBridge): DesktopBridge => {
    if (
      nativeNotifications === undefined ||
      subscribeNativeNotifications === undefined
    ) {
      return base;
    }

    return {
      ...base,
      // @effect-diagnostics-next-line asyncFunction:off -- Only decoded versioned notification operations and replies cross the isolated native Promise boundary.
      nativeNotifications: async (
        request: typeof NativeNotificationRequest.Type
      ) => {
        const validated = Schema.decodeOption(NativeNotificationRequest, {
          onExcessProperty: "error",
        })(request);

        if (Option.isNone(validated)) {
          throw new Error("Invalid notification request");
        }

        const encoded = Schema.encodeOption(nativeNotificationWire.request, {
          onExcessProperty: "error",
        })(validated.value);

        if (Option.isNone(encoded)) {
          throw new Error("Invalid notification request");
        }

        return reply(
          nativeNotificationWire.reply,
          await nativeNotifications(encoded.value)
        );
      },
      onNativeNotification: (
        listener: (notice: typeof NativeNotificationNotice.Type) => void
      ) =>
        subscribeNativeNotifications((message) => {
          const notice = decode(nativeNotificationWire.notice, message);

          if (Option.isSome(notice)) {
            listener(notice.value.notice);
          }
        }),
    };
  };

  const exposeNotificationSettings = (base: DesktopBridge): DesktopBridge => {
    const { notificationSettings } = port;

    if (notificationSettings === undefined) {
      return base;
    }

    return {
      ...base,
      // @effect-diagnostics-next-line asyncFunction:off -- The isolated preload admits only versioned settings intents and matching decoded native replies, never renderer URLs.
      notificationSettings: async (request) => {
        const admitted = Schema.decodeOption(NotificationSettingsRequest, {
          onExcessProperty: "error",
        })(request);

        if (Option.isNone(admitted)) {
          port.rejected();
          throw new Error("Invalid notification settings request");
        }

        const encoded = Schema.encodeOption(notificationSettingsWire.request)(
          admitted.value
        );

        if (Option.isNone(encoded)) {
          port.rejected();
          throw new Error("Invalid notification settings request");
        }

        const result = Schema.decodeOption(notificationSettingsWire.reply, {
          onExcessProperty: "error",
        })(await notificationSettings(encoded.value));

        if (
          Option.isNone(result) ||
          !notificationSettingsReplyMatches(admitted.value, result.value)
        ) {
          port.rejected();
          throw new Error("Invalid notification settings reply");
        }

        return result.value;
      },
    };
  };

  const exposeAbout = (base: DesktopBridge): DesktopBridge => {
    const { showAbout } = port;

    if (showAbout === undefined) {
      return base;
    }

    return {
      ...base,
      // @effect-diagnostics-next-line asyncFunction:off -- The additive isolated method admits only the closed versioned About request and reply, not caller metadata.
      showAbout: async (request) => {
        const encoded = Schema.encodeOption(aboutWire.request, {
          onExcessProperty: "error",
        })(request);

        if (Option.isNone(encoded)) {
          port.rejected();
          throw new Error("Invalid About request");
        }

        const decoded = Schema.decodeOption(aboutWire.reply, {
          onExcessProperty: "error",
        })(await showAbout(encoded.value));

        if (Option.isNone(decoded)) {
          port.rejected();
          throw new Error("Invalid About reply");
        }

        return decoded.value;
      },
    };
  };

  const bridge: DesktopBridge = {
    // @effect-diagnostics-next-line asyncFunction:off -- The isolated preload exposes decoded native IPC Promises to the hosted page.
    getSettings: async () =>
      reply(desktopWire.settings, await port.getSettings()),
    // @effect-diagnostics-next-line asyncFunction:off -- Native meeting joins return an accepted handoff result through the IPC Promise boundary.
    joinMeeting: async (request) => {
      const encoded = encode(desktopWire.join, request);

      if (Option.isNone(encoded)) {
        return MeetingJoinOutcome.cases.Failed.make({
          message: "Meeting join request is not allowed.",
        });
      }

      return reply(
        desktopWire.joinReply,
        await port.joinMeeting(encoded.value)
      );
    },
    onAction: (listener) =>
      port.subscribeActions((message) => {
        const action = decode(desktopWire.action, message);

        if (Option.isSome(action)) {
          listener(action.value);
        }
      }),
    onSettings: (listener) =>
      port.subscribeSettings((message) => {
        const settings = decode(desktopWire.settings, message);

        if (Option.isSome(settings)) {
          listener(settings.value);
        }
      }),
    // @effect-diagnostics-next-line asyncFunction:off -- A user-only preview crosses the same isolated native Promise boundary as preferences.
    previewSound: async (sound) => {
      const encoded = encode(desktopWire.previewSound, { sound });

      if (Option.isNone(encoded) || port.previewSound === undefined) {
        return false;
      }

      return reply(
        desktopWire.previewSoundReply,
        await port.previewSound(encoded.value)
      );
    },
    publishAgenda: (snapshot) => {
      const encoded = encode(desktopWire.agenda, snapshot);

      if (Option.isSome(encoded)) {
        port.publishAgenda(encoded.value);
      }
    },
    // @effect-diagnostics-next-line asyncFunction:off -- The context-isolated page receives only decoded native IPC replies.
    savePreferences: async (preferences) => {
      const encoded = encode(desktopWire.preferences, preferences);

      if (Option.isNone(encoded)) {
        throw new Error("Invalid desktop preferences");
      }

      return reply(
        desktopWire.reply,
        await port.savePreferences(encoded.value)
      );
    },
    // @effect-diagnostics-next-line asyncFunction:off -- Login changes cross Electron's native Promise-based IPC boundary.
    setStartup: async (request) => {
      const encoded = encode(desktopWire.startup, request);

      if (Option.isNone(encoded)) {
        throw new Error("Invalid startup request");
      }

      return reply(desktopWire.reply, await port.setStartup(encoded.value));
    },
  };

  const exposed = exposeAbout(exposeNotificationSettings(exposeNative(bridge)));

  if (saveIcs === undefined) {
    return Object.freeze(exposed);
  }

  return Object.freeze({
    ...exposed,
    // @effect-diagnostics-next-line asyncFunction:off -- The isolated preload validates the bounded ICS request and native completion before exposing the result.
    saveIcs: async (request: typeof IcsSaveRequest.Type) => {
      const encoded = Schema.encodeOption(
        desktopWire.saveIcs,
        icsSaveParseOptions
      )(request);

      if (Option.isNone(encoded)) {
        port.rejected();

        return IcsSaveOutcome.cases.Failed.make({ reason: "invalid" });
      }

      const message = await saveIcs(encoded.value);

      const decoded = Schema.decodeOption(
        desktopWire.saveIcsReply,
        icsSaveParseOptions
      )(message);

      if (Option.isNone(decoded)) {
        port.rejected();

        throw new Error("Invalid ICS save reply");
      }

      return decoded.value;
    },
  });
};

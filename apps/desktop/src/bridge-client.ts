import {
  IcsSaveOutcome,
  MeetingJoinOutcome,
  desktopWire,
  icsSaveParseOptions,
} from "@calendar/core/desktop-bridge";
import type {
  DesktopBridge,
  IcsSaveRequest,
} from "@calendar/core/desktop-bridge";
import { Option, Schema } from "effect";

export interface RendererBridgePort {
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

  if (saveIcs === undefined) {
    return Object.freeze(bridge);
  }

  return Object.freeze({
    ...bridge,
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

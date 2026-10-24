import { promptWire } from "@calendar/core/desktop-bridge";
import type { PromptBridge, PromptView } from "@calendar/core/desktop-bridge";
import { Option, Schema } from "effect";

export interface PromptClientPort {
  readonly act: (message: string) => void;
  readonly read: () => Promise<string>;
  readonly rejected: () => void;
  readonly soundReply: (message: string) => void;
  readonly subscribeSound: (receive: (message: string) => void) => () => void;
  readonly subscribe: (receive: (message: string) => void) => () => void;
}

export const createPromptBridge = (port: PromptClientPort): PromptBridge => {
  const cached = { view: Option.none<typeof PromptView.Type>() };

  const accept = (view: typeof PromptView.Type): boolean => {
    if (
      Option.isSome(cached.view) &&
      cached.view.value.revision > view.revision
    ) {
      return false;
    }

    cached.view = Option.some(view);

    return true;
  };

  return Object.freeze({
    act: (action) => {
      const message = Schema.encodeOption(promptWire.action)(action);

      if (Option.isSome(message)) {
        port.act(message.value);
      } else {
        port.rejected();
      }
    },
    // @effect-diagnostics-next-line asyncFunction:off -- The isolated preload owns one decoded native Promise and fences its result against newer pushed views.
    getView: async () => {
      const decoded = Schema.decodeOption(promptWire.view)(await port.read());

      if (Option.isNone(decoded)) {
        port.rejected();
        throw new Error("Invalid prompt content");
      }

      accept(decoded.value);

      return Option.getOrElse(cached.view, () => decoded.value);
    },
    onSound: (receive) =>
      port.subscribeSound((message) => {
        const decoded = Schema.decodeOption(promptWire.sound)(message);

        if (Option.isSome(decoded)) {
          receive(decoded.value);
        } else {
          port.rejected();
        }
      }),
    onView: (receive) =>
      port.subscribe((message) => {
        const decoded = Schema.decodeOption(promptWire.view)(message);

        if (Option.isSome(decoded)) {
          if (accept(decoded.value)) {
            receive(decoded.value);
          }
        } else {
          port.rejected();
        }
      }),
    soundReply: (reply) => {
      const message = Schema.encodeOption(promptWire.soundReply)(reply);

      if (Option.isSome(message)) {
        port.soundReply(message.value);
      } else {
        port.rejected();
      }
    },
  } satisfies PromptBridge);
};

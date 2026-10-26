import { expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";

import type { NativeNotificationSignal } from "../src/native-notifications.js";
import { bindNativeNotification } from "../src/notification-surface.js";
import type {
  NotificationActionEvent,
  NotificationSurface,
} from "../src/notification-surface.js";

interface SurfaceEvent extends NotificationActionEvent {
  readonly diagnostic?: string;
  readonly reply?: string;
}

type Receiver = (event: NotificationActionEvent, index: number) => void;

class Surface implements NotificationSurface {
  closed = 0;
  fail = false;
  readonly listeners = new Map<string, Receiver[]>();
  shown = 0;

  close() {
    this.closed += 1;
  }
  emit(name: string, event: SurfaceEvent = {}, index = 0) {
    for (const receive of this.listeners.get(name) ?? []) {
      receive(event, index);
    }
  }
  on(name: string, receive: Receiver) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), receive]);
  }
  onAction(receive: Receiver) {
    this.on("action", receive);
  }
  onClick(receive: () => void) {
    this.on("click", receive);
  }
  onClose(receive: () => void) {
    this.on("close", receive);
  }
  onFailed(receive: () => void) {
    this.on("failed", receive);
  }
  onReply(receive: () => void) {
    this.on("reply", receive);
  }
  onShow(receive: () => void) {
    this.on("show", receive);
  }
  removeAllListeners() {
    this.listeners.clear();
  }
  show() {
    this.shown += 1;

    if (this.fail) {
      throw new Error("Fake native display failed");
    }
  }
}

it.effect(
  "the real native callback binder forwards lifecycle and index but never retains raw reply text",
  () =>
    Effect.gen(function* callbacks() {
      const surface = new Surface();
      const signals: NativeNotificationSignal[] = [];

      const handle = bindNativeNotification(surface, (signal) => {
        signals.push(signal);
      });

      yield* handle.show;
      surface.emit("show");
      surface.emit("click");
      surface.emit("action", { actionIndex: 2 }, 99);
      surface.emit("reply", { reply: "private reply" });
      surface.emit("failed", { diagnostic: "native diagnostic" });
      surface.emit("close");
      expect(signals).toEqual([
        { kind: "show" },
        { kind: "click" },
        { index: 2, kind: "action" },
        { kind: "reply" },
        { kind: "failed" },
        { kind: "close" },
      ]);
      expect(JSON.stringify(signals)).not.toContain("private reply");
      expect(surface.shown).toBe(1);
      yield* handle.close;
      surface.emit("action", { actionIndex: 0 });
      expect(signals).toHaveLength(6);
      expect(surface.closed).toBe(1);
    })
);

it.effect(
  "native show exceptions remain typed failed work rather than a false show acknowledgement",
  () =>
    Effect.gen(function* showFailure() {
      const surface = new Surface();
      const signals: NativeNotificationSignal[] = [];
      surface.fail = true;

      const handle = bindNativeNotification(surface, (signal) => {
        signals.push(signal);
      });

      const result = yield* handle.show.pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
      expect(signals).toEqual([]);
      yield* handle.close;
    })
);

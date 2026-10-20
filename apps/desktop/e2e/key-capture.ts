import { Option, Schema } from "effect";
import type { Page } from "playwright-core";

const KeyRecord = Schema.Struct({
  composing: Schema.Boolean,
  defaultPrevented: Schema.Boolean,
  documentEpoch: Schema.Finite,
  key: Schema.String,
  meta: Schema.Boolean,
  phase: Schema.Literals(["capture", "settled"]),
  repeat: Schema.Boolean,
  targetTag: Schema.Union([Schema.Null, Schema.String]),
  timestamp: Schema.Finite,
});

declare global {
  interface Window {
    readonly __calendarDesktopKeyProof?: (
      record: typeof KeyRecord.Type
    ) => void;
  }
}

// @effect-diagnostics-next-line asyncFunction:off -- The owned key probe observes capture and completed propagation without preventing or dispatching keys.
export const capturePageKeys = async (page: Page) => {
  const records: (typeof KeyRecord.Type)[] = [];

  const binding = await page.exposeBinding(
    "__calendarDesktopKeyProof",
    (source, input: typeof KeyRecord.Encoded) => {
      if (source.frame !== page.mainFrame()) {
        return;
      }

      const record = Schema.decodeOption(KeyRecord)(input);

      if (Option.isSome(record) && records.length < 128) {
        records.push(record.value);
      }
    }
  );

  await page.evaluate(() => {
    const controller = new AbortController();

    // oxlint-disable-next-line unicorn/consistent-function-scoping -- The key projection must remain inside the serialized page callback.
    const record = (event: KeyboardEvent, phase: "capture" | "settled") => {
      window.__calendarDesktopKeyProof?.({
        composing: event.isComposing,
        defaultPrevented: event.defaultPrevented,
        documentEpoch: performance.timeOrigin,
        key: event.key,
        meta: event.metaKey,
        phase,
        repeat: event.repeat,
        targetTag:
          event.target instanceof Element ? event.target.tagName : null,
        timestamp: performance.timeOrigin + performance.now(),
      });
    };

    window.addEventListener(
      "keydown",
      (event) => {
        record(event, "capture");
        requestAnimationFrame(() => {
          record(event, "settled");
        });
      },
      { capture: true, signal: controller.signal }
    );
    window.addEventListener(
      "desktop-proof-keys-close",
      () => {
        controller.abort();
      },
      { once: true }
    );
  });

  return {
    // @effect-diagnostics-next-line asyncFunction:off -- The probe aborts its event listeners and disposes only its own Playwright binding.
    close: async () => {
      if (!page.isClosed()) {
        await page.evaluate(() => {
          window.dispatchEvent(new Event("desktop-proof-keys-close"));
          Reflect.deleteProperty(window, "__calendarDesktopKeyProof");
        });
      }

      await binding.dispose();
    },
    records,
  };
};

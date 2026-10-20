import { DateTime, Option, Schema } from "effect";
import type { Page } from "playwright-core";

import { HostedState } from "./hosted-diagnostics.ts";
import type { HostedStateValue } from "./hosted-diagnostics.ts";

export interface DesktopStateCapture {
  readonly acknowledged: (title: string) => number | undefined;
  readonly close: () => Promise<void>;
  readonly states: readonly HostedStateValue[];
  readonly stats: () => { droppedStates: number; invalidStates: number };
}

// @effect-diagnostics-next-line asyncFunction:off -- One owned Playwright binding spans authentication and both keyboard/hosted proof phases.
export const captureDesktopState = async (
  page: Page
): Promise<DesktopStateCapture> => {
  const states: HostedStateValue[] = [];
  let invalidStates = 0;
  let droppedStates = 0;
  let active = true;
  let signature = "";
  let acknowledged: { timestamp: number; title: string } | undefined;

  const binding = await page.exposeBinding(
    "__calendarDesktopProof",
    (source, input: typeof HostedState.Encoded) => {
      if (!active || source.frame !== page.mainFrame()) {
        return;
      }

      const decoded = Schema.decodeOption(HostedState)(input);

      if (Option.isNone(decoded)) {
        invalidStates += 1;

        return;
      }

      const state = {
        ...decoded.value,
        timestamp: DateTime.toEpochMillis(DateTime.nowUnsafe()),
      };

      const next = JSON.stringify({
        ...state,
        now: 0,
        timestamp: 0,
        trigger: "",
      });

      if (next !== signature) {
        if (states.length < 1024) {
          states.push(state);
        } else {
          droppedStates += 1;
        }

        signature = next;
      }

      if (state.saveAcknowledged && state.acknowledgedTitle !== null) {
        acknowledged = {
          timestamp: state.timestamp,
          title: state.acknowledgedTitle,
        };
      }
    }
  );

  return {
    acknowledged: (title) =>
      acknowledged?.title === title ? acknowledged.timestamp : undefined,
    // @effect-diagnostics-next-line asyncFunction:off -- Removing the owned binding disables future development callbacks before application disposal.
    close: async () => {
      active = false;

      if (!page.isClosed()) {
        await page.evaluate(() => {
          Reflect.deleteProperty(window, "__calendarDesktopProof");
        });
      }

      await binding.dispose();
    },
    states,
    stats: () => ({ droppedStates, invalidStates }),
  };
};

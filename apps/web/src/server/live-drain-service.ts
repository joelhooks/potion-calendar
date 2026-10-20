import type { CalendarFailureValue, Provider } from "@calendar/calendar";
import { Context, Data } from "effect";
import type { Effect } from "effect";

import type { LiveJobValue, LiveOutputValue } from "./live-work.js";

export interface FailedStep {
  readonly _tag: "Failed";
  readonly error: CalendarFailureValue;
  readonly job: LiveJobValue | undefined;
}

export type DrainStep =
  | FailedStep
  | {
      readonly _tag: "Completed";
      readonly followup: boolean;
      readonly output: LiveOutputValue;
    }
  | { readonly _tag: "Empty"; readonly output: LiveOutputValue | undefined };

export const Step = Data.taggedEnum<DrainStep>();

export class DrainService extends Context.Service<
  DrainService,
  {
    readonly process: (key: string) => Effect.Effect<DrainStep>;
    readonly recover: (step: FailedStep) => Effect.Effect<void, Provider>;
  }
>()("@calendar/web/DrainService") {}

import { Effect } from "effect";

export const startMain = (work: Effect.Effect<void>): void => {
  void Effect.runPromise(work);
};

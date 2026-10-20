import { Context } from "effect";
import type { Effect } from "effect";

import type { AnyContract } from "./contract.js";

export type Around<Failure = never, Requirements = never> = <A, E, R>(
  contract: AnyContract,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The decoded input is erased by implement across heterogeneous capability lists.
  input: unknown,
  run: Effect.Effect<A, E, R>
) => Effect.Effect<A, E | Failure, R | Requirements>;

export interface CallWatchService {
  readonly around: Around;
}

const passThrough: Around = (_contract, _input, run) => run;

export const CallWatch = Context.Reference<CallWatchService>(
  "@calendar/capability/CallWatch",
  { defaultValue: () => ({ around: passThrough }) }
);

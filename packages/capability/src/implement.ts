import { Data, Effect } from "effect";

import { Approval } from "./approval.js";
import { CallWatch } from "./call-watch.js";
import type { Around } from "./call-watch.js";
import type {
  AnyCapability,
  AnyContract,
  Capability,
  InputOf,
  OutputOf,
  ContractFailureOf,
} from "./contract.js";

class CapabilityRecord extends Data.TaggedClass("Capability")<
  Omit<AnyCapability, "_tag">
> {}

export const implement = <
  ContractType extends AnyContract,
  Requirements = never,
>(
  contract: ContractType,
  handler: (
    input: InputOf<ContractType>["Type"]
  ) => Effect.Effect<
    OutputOf<ContractType>["Type"],
    ContractFailureOf<ContractType>["Type"],
    Requirements
  >
): Capability<ContractType, Requirements> => {
  const implementationHandler = (input: never) =>
    Effect.gen(function* callWithWatch() {
      const watch = yield* CallWatch;

      const run = contract.needsApproval
        ? Effect.gen(function* approvedHandler() {
            const approval = yield* Approval;
            yield* approval.approve(contract.name, input);

            return yield* handler(input);
          })
        : handler(input);

      return yield* watch.around(contract, input, run);
    });

  const capability = new CapabilityRecord({
    contract,
    handler: implementationHandler,
  });

  // SAFETY: the runtime branch uses the same literal approval flag stored on the contract type and adds only the corresponding Approval requirement and ApprovalDenied failure.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions -- The heterogeneous record erases its handler channels until the public generic type is restored.
  return capability as unknown as Capability<ContractType, Requirements>;
};

export type { Around } from "./call-watch.js";

export function aroundHandlers<const Caps extends readonly AnyCapability[]>(
  capabilities: Caps,
  around: Around
): Caps;
export function aroundHandlers<
  ContractType extends AnyContract,
  Requirements,
  ExtraRequirements = never,
>(
  capabilities: readonly [Capability<ContractType, Requirements>],
  around: Around<ContractFailureOf<ContractType>["Type"], ExtraRequirements>
): readonly [Capability<ContractType, Requirements | ExtraRequirements>];
export function aroundHandlers(
  capabilities: readonly AnyCapability[],
  around: Around<unknown, unknown>
): readonly AnyCapability[] {
  const wrapped = capabilities.map(
    ({ contract, handler }) =>
      new CapabilityRecord({
        contract,
        handler: (input: never) =>
          // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- The erased handler of a heterogeneous list; `Around` preserves whatever channels it has.
          around(contract, input, handler(input)),
      })
  );

  return wrapped;
}

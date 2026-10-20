import { defineContract } from "@calendar/capability/contract";
import { toRpcGroup } from "@calendar/capability/rpc-group";
import type { Effect } from "effect";
import { Schema } from "effect";
import { RpcClient } from "effect/rpc";
import { expect, expectTypeOf, it } from "vitest";

const input = Schema.Struct({ query: Schema.String });

const output = Schema.Struct({ matches: Schema.Array(Schema.String) });

const failure = Schema.Never;

const searchContract = defineContract("search", {
  annotations: { readOnly: true },
  description: "Search resources",
  failure,
  input,
  output,
});

const group = toRpcGroup([searchContract]);

it("builds the client RPC group from contracts alone", () => {
  expect([...group.group.requests.keys()]).toEqual(["search"]);
  expect(group.group.requests.get("search")?.payloadSchema).toBe(input);
  expect(group.group.requests.get("search")?.successSchema).toBe(output);
  expect(group.group.requests.get("search")?.errorSchema).toBe(failure);
});

const toggleContract = defineContract("toggle", {
  annotations: { readOnly: true },
  description: "Read toggle state",
  failure: Schema.Never,
  input: Schema.Struct({ key: Schema.String }),
  output: Schema.Struct({ enabled: Schema.Boolean }),
});

const contracts = [searchContract, toggleContract] as const;

const tupleClient = RpcClient.make(toRpcGroup(contracts).group);

const filteredContracts = contracts.filter(
  (contract) => contract.annotations.readOnly
);

const filteredClient = RpcClient.make(toRpcGroup(filteredContracts).group);

type TupleClient = Effect.Success<typeof tupleClient>;

type FilteredClient = Effect.Success<typeof filteredClient>;

it("tuple contracts retain their own input and result types", () => {
  expectTypeOf<
    Effect.Success<ReturnType<TupleClient["search"]>>
  >().toEqualTypeOf<typeof output.Type>();
  expectTypeOf<
    Effect.Success<ReturnType<TupleClient["toggle"]>>
  >().toEqualTypeOf<{ readonly enabled: boolean }>();
  expectTypeOf<Parameters<TupleClient["search"]>[0]>().toEqualTypeOf<
    typeof input.Type
  >();
  expectTypeOf<Parameters<TupleClient["toggle"]>[0]>().toEqualTypeOf<{
    readonly key: string;
  }>();
});

it("filtered contract arrays retain per-method input and result types", () => {
  expectTypeOf<
    Effect.Success<ReturnType<FilteredClient["search"]>>
  >().toEqualTypeOf<typeof output.Type>();
  expectTypeOf<
    Effect.Success<ReturnType<FilteredClient["toggle"]>>
  >().toEqualTypeOf<{ readonly enabled: boolean }>();
  expectTypeOf<Parameters<FilteredClient["search"]>[0]>().toEqualTypeOf<
    typeof input.Type
  >();
  expectTypeOf<Parameters<FilteredClient["toggle"]>[0]>().toEqualTypeOf<{
    readonly key: string;
  }>();
});

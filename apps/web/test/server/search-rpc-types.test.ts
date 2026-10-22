import { calendarContracts } from "@calendar/calendar/contracts";
import { toRpcGroup } from "@calendar/capability/rpc-group";
import { sessionContract } from "@calendar/core/contracts";
import type { Effect } from "effect";
import { RpcClient } from "effect/rpc";
import { expectTypeOf, it } from "vitest";

import { browserGroup } from "../../src/client/rpc.js";
import type {
  SearchRequest,
  SearchResponse,
} from "../../src/search-contract.js";

const previousClient = RpcClient.make(
  toRpcGroup([sessionContract, ...calendarContracts]).group
);

const currentClient = RpcClient.make(browserGroup);

type PreviousClient = Effect.Success<typeof previousClient>;

type CurrentClient = Effect.Success<typeof currentClient>;

it("existing browser methods keep their exact input, output, and failure types", () => {
  expectTypeOf<Omit<CurrentClient, "searchEvents">>().toEqualTypeOf<
    Omit<PreviousClient, "searchEvents">
  >();
});

it("browser search infers the public request and account-aware response, never a client calendar set", () => {
  expectTypeOf<Parameters<CurrentClient["searchEvents"]>[0]>().toEqualTypeOf<
    (typeof SearchRequest)["~type.make.in"]
  >();
  expectTypeOf<
    NonNullable<Parameters<CurrentClient["searchEvents"]>[0]["calendars"]>
  >().toEqualTypeOf<never>();
  expectTypeOf<
    Effect.Success<ReturnType<CurrentClient["searchEvents"]>>
  >().toEqualTypeOf<typeof SearchResponse.Type>();
});

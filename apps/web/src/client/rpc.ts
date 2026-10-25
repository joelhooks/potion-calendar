import {
  calendarContracts,
  searchEventsContract as coreSearchEventsContract,
} from "@calendar/calendar/contracts";
import { toRpcGroup } from "@calendar/capability/rpc-group";
import {
  sessionContract,
  deleteAccountContract,
  saveProfileContract,
} from "@calendar/core/contracts";
import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";

import { searchEventsContract } from "../search-contract.js";

export const browserGroup = toRpcGroup([
  sessionContract,
  deleteAccountContract,
  saveProfileContract,
  ...calendarContracts.filter(
    (
      contract
    ): contract is Exclude<
      (typeof calendarContracts)[number],
      typeof coreSearchEventsContract
    > => contract !== coreSearchEventsContract
  ),
  searchEventsContract,
]).group;

export const protocol = RpcClient.layerProtocolHttp({ url: "/rpc" }).pipe(
  Layer.provide(RpcSerialization.layerJson),
  Layer.provide(FetchHttpClient.layer)
);

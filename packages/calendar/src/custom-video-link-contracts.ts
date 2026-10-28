import { defineContract } from "@calendar/capability/contract";
import { Schema } from "effect";

import { CustomVideoLink, CustomVideoLinks } from "./custom-video-link.js";
import { NotConnected, Provider, Revoked } from "./errors.js";

export const CustomVideoCatalog = Schema.Struct({
  conflicts: Schema.Array(Schema.String),
  entries: CustomVideoLinks,
});

export const CustomVideoFailure = Schema.Union([
  NotConnected,
  Provider,
  Revoked,
]);

export const ImportCustomVideoLinksInput = Schema.Struct({
  entries: CustomVideoLinks,
});

export const SaveCustomVideoLinkInput = Schema.Struct({
  ...CustomVideoLink.fields,
  create: Schema.Boolean,
});

export const RemoveCustomVideoLinkInput = Schema.Struct({
  id: Schema.NonEmptyString,
});

export const readCustomVideoLinksContract = defineContract(
  "readCustomVideoLinks",
  {
    annotations: { idempotent: true, readOnly: true },
    description: "Read the authenticated person's saved custom video links",
    failure: CustomVideoFailure,
    input: Schema.Struct({}),
    output: CustomVideoCatalog,
  }
);

export const importCustomVideoLinksContract = defineContract(
  "importCustomVideoLinks",
  {
    annotations: { idempotent: true, readOnly: false },
    description:
      "Atomically import legacy links without overwriting server IDs or tombstones",
    failure: CustomVideoFailure,
    input: ImportCustomVideoLinksInput,
    output: CustomVideoCatalog,
  }
);

export const saveCustomVideoLinkContract = defineContract(
  "saveCustomVideoLink",
  {
    annotations: { idempotent: true, readOnly: false },
    description:
      "Create or edit one authenticated person's active custom video link",
    failure: CustomVideoFailure,
    input: SaveCustomVideoLinkInput,
    output: CustomVideoCatalog,
  }
);

export const removeCustomVideoLinkContract = defineContract(
  "removeCustomVideoLink",
  {
    annotations: { idempotent: true, readOnly: false },
    description:
      "Atomically retire a custom link and remove account references while keeping none shadows",
    failure: CustomVideoFailure,
    input: RemoveCustomVideoLinkInput,
    output: CustomVideoCatalog,
  }
);

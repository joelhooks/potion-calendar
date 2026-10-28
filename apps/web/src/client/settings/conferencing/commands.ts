import * as BrowserCrypto from "@effect/platform-browser/BrowserCrypto";
import { Crypto, Effect, Option, Schema } from "effect";
import { RpcClient } from "effect/rpc";
import { Command } from "foldkit";

import { Message } from "../../message.js";
import { browserGroup, protocol } from "../../rpc.js";
import { modifyPreferences } from "../preference-storage.js";
import { UserDefaultConferencing, deskDefaultConferencing } from "./default.js";
import {
  ConferencingSettingsChange,
  CustomVideoLinks,
  CustomVideoWrite,
} from "./model.js";

export const SaveDefaultConferencing = Command.define(
  "SaveDefaultConferencing",
  {
    args: {
      personId: Schema.String,
      requestId: Schema.Int,
      value: UserDefaultConferencing,
    },
    execute: ({ personId, requestId, value }) =>
      modifyPreferences(personId, (current) => ({
        ...current,
        defaultConferencing: value,
      })).pipe(
        Effect.match({
          onFailure: () =>
            Message.ChangedConferencingSettings({
              change: ConferencingSettingsChange.cases.DefaultFailed.make({
                message:
                  "Default conferencing could not be saved. Your previous choice is still in use.",
                requestId,
              }),
              personId,
            }),
          onSuccess: (saved) =>
            Message.ChangedConferencingSettings({
              change: ConferencingSettingsChange.cases.DefaultSaved.make({
                requestId,
                value: saved.defaultConferencing ?? deskDefaultConferencing,
              }),
              personId,
            }),
        })
      ),
    messages: [Message.ChangedConferencingSettings],
  }
);

export const LoadCustomVideoLinks = Command.define("LoadCustomVideoLinks", {
  args: {
    entries: CustomVideoLinks,
    personId: Schema.String,
    requestId: Schema.Int,
  },
  execute: ({ entries, personId, requestId }) =>
    Effect.gen(function* loadCustomVideoLinks() {
      const client = yield* RpcClient.make(browserGroup);

      return yield* client.importCustomVideoLinks({ entries });
    }).pipe(
      Effect.provide(protocol),
      Effect.scoped,
      Effect.match({
        onFailure: () =>
          Message.ChangedConferencingSettings({
            change: ConferencingSettingsChange.cases.LoadFailed.make({
              message:
                "Custom links could not be confirmed. Your browser's import source is unchanged. Reload to reconcile.",
              requestId,
            }),
            personId,
          }),
        onSuccess: (catalog) =>
          Message.ChangedConferencingSettings({
            change: ConferencingSettingsChange.cases.Loaded.make({
              catalog,
              requestId,
            }),
            personId,
          }),
      })
    ),
  messages: [Message.ChangedConferencingSettings],
});

export const SaveCustomVideoLinks = Command.define("SaveCustomVideoLinks", {
  args: {
    personId: Schema.String,
    requestId: Schema.Int,
    write: CustomVideoWrite,
  },
  execute: ({ personId, requestId, write }) =>
    Effect.gen(function* saveCustomVideoLinks() {
      const id = CustomVideoWrite.guards.Remove(write)
        ? write.id
        : yield* Option.match(write.id, {
            onNone: () => Crypto.Crypto.use((crypto) => crypto.randomUUIDv4),
            onSome: Effect.succeed,
          });

      const knownWrite = CustomVideoWrite.guards.Remove(write)
        ? write
        : CustomVideoWrite.cases.Save.make({
            ...write,
            create: write.create ?? Option.isNone(write.id),
            id: Option.some(id),
          });

      return yield* Effect.gen(function* persistCustomVideoLink() {
        const client = yield* RpcClient.make(browserGroup);

        return CustomVideoWrite.guards.Remove(write)
          ? yield* client.removeCustomVideoLink({ id })
          : yield* client.saveCustomVideoLink({
              create: write.create ?? Option.isNone(write.id),
              id,
              link: write.link,
              name: write.name,
            });
      }).pipe(
        Effect.provide(protocol),
        Effect.scoped,
        Effect.match({
          onFailure: () =>
            Message.ChangedConferencingSettings({
              change: ConferencingSettingsChange.cases.Unconfirmed.make({
                message:
                  "The change could not be confirmed. It may have been saved. Reload to reconcile before retrying.",
                requestId,
                write: knownWrite,
              }),
              personId,
            }),
          onSuccess: (catalog) =>
            Message.ChangedConferencingSettings({
              change: ConferencingSettingsChange.cases.Saved.make({
                entries: catalog.entries,
                requestId,
              }),
              personId,
            }),
        })
      );
    }).pipe(
      Effect.provide(BrowserCrypto.layer),
      Effect.orElseSucceed(() =>
        Message.ChangedConferencingSettings({
          change: ConferencingSettingsChange.cases.Failed.make({
            message:
              "The custom link request could not be prepared. Your draft is still here.",
            requestId,
          }),
          personId,
        })
      )
    ),
  messages: [Message.ChangedConferencingSettings],
});

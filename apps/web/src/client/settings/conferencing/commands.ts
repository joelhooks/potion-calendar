import * as BrowserCrypto from "@effect/platform-browser/BrowserCrypto";
import { Crypto, Effect, Option, Schema } from "effect";
import { Command } from "foldkit";

import { Message } from "../../message.js";
import { modifyPreferences } from "../preference-storage.js";
import {
  ConferencingSettingsChange,
  CustomVideoLinks,
  CustomVideoWrite,
  normalizedVideoLink,
} from "./model.js";

export const SaveCustomVideoLinks = Command.define("SaveCustomVideoLinks", {
  args: {
    personId: Schema.String,
    requestId: Schema.Int,
    write: CustomVideoWrite,
  },
  execute: ({ personId, requestId, write }) =>
    Effect.gen(function* saveCustomVideoLinks() {
      const existingId = CustomVideoWrite.guards.Save(write)
        ? write.id
        : Option.some(write.id);

      const id = yield* Option.match(existingId, {
        onNone: () => Crypto.Crypto.use((crypto) => crypto.randomUUIDv4),
        onSome: Effect.succeed,
      });

      const saved = yield* modifyPreferences(personId, (current) => {
        const entries = current.customVideoLinks ?? [];
        const existing = entries.findIndex((entry) => entry.id === id);

        const next = CustomVideoWrite.match(write, {
          Remove: () => {
            if (existing === -1) {
              throw new Error("Custom video link no longer exists");
            }

            return entries.filter((entry) => entry.id !== id);
          },
          Save: (input) => {
            const entry = {
              id,
              link: Option.getOrThrow(normalizedVideoLink(input.link)),
              name: input.name.trim(),
            };

            if (Option.isSome(input.id) && existing === -1) {
              throw new Error("Custom video link no longer exists");
            }

            return existing === -1
              ? [...entries, entry]
              : entries.map((previous) =>
                  previous.id === id ? entry : previous
                );
          },
        });

        return {
          ...current,
          customVideoLinks: Schema.decodeSync(CustomVideoLinks)(next),
        };
      });

      return saved.customVideoLinks ?? [];
    }).pipe(
      Effect.provide(BrowserCrypto.layer),
      Effect.match({
        onFailure: () =>
          Message.ChangedConferencingSettings({
            change: ConferencingSettingsChange.cases.Failed.make({
              message: CustomVideoWrite.guards.Remove(write)
                ? "Custom video link could not be removed. It is still saved on this browser."
                : "Custom video link could not be saved. Your changes are still here.",
              requestId,
            }),
            personId,
          }),
        onSuccess: (entries) =>
          Message.ChangedConferencingSettings({
            change: ConferencingSettingsChange.cases.Saved.make({
              entries,
              requestId,
            }),
            personId,
          }),
      })
    ),
  messages: [Message.ChangedConferencingSettings],
});

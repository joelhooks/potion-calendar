import { Effect, Option, Stream } from "effect";

import type { AppModel } from "../app.js";
import { Message } from "../message.js";
import { trackClipboardPointer } from "./anchor.js";
import { ClipboardDelivery } from "./delivery.js";
import { clipboardGridHost, clipboardNativeHost } from "./host.js";
import { nativeClipboardEvents } from "./native.js";
import { ClipboardRuntime } from "./runtime.js";

export const clipboardStream = (
  person: Option.Option<string>,
  epoch: number,
  readModel: () => AppModel
) =>
  Option.match(person, {
    onNone: () => Stream.empty,
    onSome: (personId) =>
      Stream.unwrap(
        Effect.gen(function* connectClipboard() {
          const runtime = yield* ClipboardRuntime;
          const connection = yield* runtime.connect(personId);

          const readAnchor = yield* trackClipboardPointer(document, () =>
            clipboardGridHost(readModel(), document)
          );

          const native = nativeClipboardEvents(
            document,
            connection.sessionId,
            () =>
              clipboardNativeHost(
                readModel(),
                connection,
                readAnchor(),
                document
              )
          ).pipe(Stream.runForEach(connection.native));

          yield* Effect.forkScoped(native);

          return connection.notices.pipe(
            Stream.map((notice) =>
              Message.ReceivedClipboard({
                delivery: ClipboardDelivery.make({
                  epoch,
                  notice,
                  personId,
                  sessionId: connection.sessionId,
                }),
              })
            )
          );
        })
      ),
  });

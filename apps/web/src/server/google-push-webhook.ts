// @effect-diagnostics-next-line nodeBuiltinImport:off -- Cloudflare nodejs_compat supplies a native constant-time comparison for fixed-length token digests.
import { timingSafeEqual } from "node:crypto";

import { allowedEmail } from "@calendar/auth/google";
import { Provider } from "@calendar/calendar";
import type {
  GooglePushRepository,
  PushDeliveryValue,
} from "@calendar/database/google-push";
import { Clock, Effect, Option, Redacted, Schema } from "effect";

import { tokenHash } from "./google-channel-lifecycle.js";
import { GooglePushEnvelope } from "./google-push-protocol.js";

export const receiveGooglePush = Effect.fn("receiveGooglePush")(
  function* receiveGooglePush(
    request: Request,
    allowedEmails: string,
    repository: Pick<GooglePushRepository, "delivery">,
    enqueue: (
      channel: PushDeliveryValue,
      number: string,
      removed: boolean
    ) => Effect.Effect<void, Provider>
  ) {
    if (request.method !== "POST") {
      return new Response(null, { status: 405 });
    }

    const decoded = Schema.decodeUnknownOption(GooglePushEnvelope)({
      channelId: request.headers.get("x-goog-channel-id"),
      messageNumber: request.headers.get("x-goog-message-number"),
      resourceId: request.headers.get("x-goog-resource-id"),
      state: request.headers.get("x-goog-resource-state"),
      token: request.headers.get("x-goog-channel-token"),
    });

    if (Option.isNone(decoded)) {
      return new Response(null, { status: 404 });
    }

    const envelope = decoded.value;
    const now = yield* Clock.currentTimeMillis;

    const channel = yield* repository.delivery(envelope.channelId, now).pipe(
      Effect.tapError((error) =>
        Effect.logWarning("Google channel lookup unavailable", {
          operation: error.operation,
          reason: error.reason,
        })
      ),
      Effect.mapError(
        () =>
          new Provider({
            message: "Push registration lookup is unavailable",
            operation: "push",
            status: 0,
          })
      )
    );

    const observed = yield* tokenHash(Redacted.value(envelope.token));
    const encoder = new TextEncoder();

    const tokenMatches = timingSafeEqual(
      encoder.encode(observed),
      encoder.encode(channel?.tokenHash ?? "0".repeat(64))
    );

    if (
      channel === null ||
      !tokenMatches ||
      !allowedEmail(channel.ownerEmail, allowedEmails) ||
      !allowedEmail(channel.accountEmail, allowedEmails) ||
      (channel.resourceId !== null &&
        channel.resourceId !== envelope.resourceId)
    ) {
      return new Response(null, { status: 404 });
    }

    if (envelope.state !== "sync") {
      yield* enqueue(
        channel,
        envelope.messageNumber,
        envelope.state === "not_exists"
      );
    }

    return new Response(null, { status: 200 });
  }
);

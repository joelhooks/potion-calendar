import { createFakeAuth } from "@calendar/auth/dev/fake-google";
import { SessionSnapshot } from "@calendar/core/contracts";
import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Schema } from "effect";
import { vi } from "vitest";

import { createBackend } from "../../src/server/backend.js";

const RpcReply = Schema.Struct({
  exit: Schema.Struct({ value: SessionSnapshot }),
});

it.effect.each([
  { image: "https://calendar.test/profile-photo.svg", kind: "HTTPS image" },
  { image: null, kind: "no image" },
])(
  "session projects the authenticated name and $kind, never browser identity",
  ({ image }) =>
    Effect.gen(function* authenticatedSession() {
      const fake = createFakeAuth("http://calendar.test");

      const now = DateTime.toDateUtc(
        DateTime.makeUnsafe("2026-10-19T00:00:00Z")
      );

      const current = {
        session: {
          createdAt: now,
          expiresAt: DateTime.toDateUtc(
            DateTime.add(DateTime.fromDateUnsafe(now), { days: 1 })
          ),
          id: "server-session",
          token: "local-session-token",
          updatedAt: now,
          userId: "server-person",
        },
        user: {
          createdAt: now,
          email: "joel@example.test",
          emailVerified: true,
          id: "server-person",
          image,
          name: "Local Person",
          updatedAt: now,
        },
      };

      const getSession = vi
        .spyOn(fake.auth.api, "getSession")
        .mockResolvedValue(current);

      const request = new Request(
        "http://calendar.test/rpc?userId=browser-person",
        {
          body: '{"_tag":"Request","headers":[],"id":"1","payload":{"user":{"id":"browser-person"},"userId":"browser-person"},"tag":"session"}',
          headers: {
            "content-type": "application/json",
            "x-person-id": "browser-person",
          },
          method: "POST",
        }
      );

      const rpc = yield* Effect.acquireRelease(
        Effect.sync(() =>
          createBackend(fake.auth, fake.config, request.headers)
        ),
        (backend) => Effect.promise(backend.dispose.bind(backend))
      );

      const response = yield* Effect.promise(
        rpc.handler.bind(rpc, request, undefined)
      );

      expect(response.status).toBe(200);
      const body: unknown = yield* Effect.promise(response.json.bind(response));

      const reply = yield* Schema.decodeUnknownEffect(Schema.Array(RpcReply))(
        body
      );

      expect(reply[0]?.exit.value?.user.id).toBe(current.user.id);
      expect(reply[0]?.exit.value?.user.name).toBe(current.user.name);
      expect(reply[0]?.exit.value?.user.image).toBe(image ?? undefined);

      if (image === null) {
        expect(reply[0]?.exit.value?.user).not.toHaveProperty("image");
      }

      expect(getSession.mock.calls[0]?.[0]).toEqual({
        headers: request.headers,
      });
      getSession.mockRestore();
    })
);

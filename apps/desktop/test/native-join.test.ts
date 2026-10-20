import { expect, it } from "@effect/vitest";
import { Effect, Ref } from "effect";

import { DesktopError } from "../src/config.js";
import { runNativeJoin } from "../src/native-join.js";

it.effect("unsafe native targets fail without reaching the OS handoff", () =>
  Effect.gen(function* blockedTargets() {
    const calls = yield* Ref.make<readonly string[]>([]);

    for (const conferenceUrl of [
      "http://meet.example.test/room",
      "https://user@meet.example.test/room",
      "file:///private",
      // oxlint-disable-next-line no-script-url -- This rejected target proves the OS opener never receives executable URLs.
      "javascript:alert(1)",
    ]) {
      const outcome = yield* runNativeJoin(
        {
          conferenceUrl,
          key: { accountId: "work", calendarId: "primary", eventId: "meeting" },
        },
        (url) => Ref.update(calls, (current) => [...current, url])
      );

      expect(outcome._tag).toBe("Failed");
    }

    expect(yield* Ref.get(calls)).toEqual([]);
  })
);

it.effect("Requested is returned only after an accepted OS handoff", () =>
  Effect.gen(function* acceptedTarget() {
    const calls = yield* Ref.make<readonly string[]>([]);

    const request = {
      conferenceUrl: "https://meet.example.test/room",
      key: { accountId: "work", calendarId: "primary", eventId: "meeting" },
    };

    const outcome = yield* runNativeJoin(request, (url) =>
      Ref.update(calls, (current) => [...current, url])
    );

    expect(outcome._tag).toBe("Requested");
    expect(yield* Ref.get(calls)).toEqual([request.conferenceUrl]);

    const failed = yield* runNativeJoin(request, () =>
      Effect.fail(new DesktopError({ message: "OS refused" }))
    );

    expect(failed._tag).toBe("Failed");
  })
);

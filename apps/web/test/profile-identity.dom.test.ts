import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { AsyncData } from "foldkit";
import { renderToString } from "foldkit/experimental/server";

import {
  profileImage,
  profileInitials,
} from "../src/client/settings/profile/model.js";
import { view } from "../src/features/app.js";
import { profileFixture, profileSnapshot } from "./profile-fixture.js";

it.effect.each([
  undefined,
  "",
  "http://calendar.test/avatar.png",
  "/avatar.png",
  "data:image/svg+xml,not-an-image",
  // oxlint-disable-next-line eslint/no-script-url -- This detached schema negative case never constructs or navigates an executable image URL.
  "javascript:alert(1)",
])("identity image %s cannot cross the HTTPS boundary", (image) =>
  Effect.sync(() => {
    expect(Option.isNone(profileImage(image))).toBe(true);
  })
);

it.effect.each([
  { expected: "JH", name: "Joel Hooks" },
  { expected: "JH", name: "  joel   hooks  " },
  { expected: "李明", name: "李 明" },
  { expected: "👩‍💻P", name: "👩‍💻 Person" },
  { expected: "?", name: "" },
])(
  "initials fallback for $name preserves its expected text",
  ({ name, expected }) =>
    Effect.sync(() => {
      expect(profileInitials(name)).toBe(expected);
    })
);

it.effect(
  "missing images render identity initials and no image element or external image request",
  () =>
    Effect.gen(function* identityFallback() {
      const model = profileFixture();

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const root = new DOMParser().parseFromString(rendered.html, "text/html");
      expect(profileSnapshot(model).user.name).toBe("Calendar owner");
      expect(root.querySelector(".profile-avatar")?.textContent).toBe("CO");
      expect(root.querySelector(".profile-avatar")?.getAttribute("role")).toBe(
        "img"
      );
      expect(
        root.querySelector(".profile-avatar")?.getAttribute("aria-label")
      ).toContain(profileSnapshot(model).user.name);
      expect(root.querySelector("img")).toBeNull();
    })
);

it.effect(
  "detached SSR-only HTTPS image markup has alt text and no-referrer without loading the image",
  () =>
    Effect.gen(function* imageMarkupBoundary() {
      const base = profileFixture();
      const snapshot = profileSnapshot(base);

      const model = {
        ...base,
        session: AsyncData.Success({
          data: {
            ...snapshot,
            user: {
              ...snapshot.user,
              image: "https://calendar.test/profile-proof.svg",
            },
          },
        }),
      };

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const root = new DOMParser().parseFromString(rendered.html, "text/html");
      const image = root.querySelector(".profile-avatar");
      expect(image?.tagName).toBe("IMG");
      expect(image?.getAttribute("src")).toBe(
        "https://calendar.test/profile-proof.svg"
      );
      expect(image?.getAttribute("alt")).toContain(snapshot.user.name);
      expect(image?.getAttribute("referrerpolicy")).toBe("no-referrer");
      expect(root.defaultView).toBeNull();
    })
);

it.effect(
  "unrestricted saved name characters remain text rather than creating markup",
  () =>
    Effect.gen(function* identityTextBoundary() {
      const base = profileFixture();
      const snapshot = profileSnapshot(base);
      const name = '<img id="profile-injection" src="https://calendar.test/x">';

      const model = {
        ...base,
        profile: { ...base.profile, draft: name, savedName: name },
        session: AsyncData.Success({
          data: { ...snapshot, user: { ...snapshot.user, name } },
        }),
      };

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const root = new DOMParser().parseFromString(rendered.html, "text/html");
      expect(
        root.querySelector(".profile-identity-copy strong")?.textContent
      ).toBe(name);
      expect(root.querySelector<HTMLInputElement>("#profile-name")?.value).toBe(
        name
      );
      expect(root.querySelector("#profile-injection")).toBeNull();
      expect(root.querySelector("img")).toBeNull();
    })
);

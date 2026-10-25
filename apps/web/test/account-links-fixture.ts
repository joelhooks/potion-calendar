import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import { view } from "../src/features/app.js";
import { calendarsRedirectFixture } from "./calendars-redirect-fixture.js";
import { conferencingSettingsFixture } from "./conferencing-settings-fixture.js";

export const accountLinksFixture = (
  page: "conferencing" | "calendar",
  width: number,
  theme: "light" | "dark" = "light"
) => {
  const base =
    page === "conferencing"
      ? conferencingSettingsFixture("list").model
      : calendarsRedirectFixture("account");

  return update(
    {
      ...base,
      calendar: { ...base.calendar, viewportWidth: width },
      settings: { ...base.settings, theme },
    },
    Message.MeasuredShellViewport({ width })
  ).model;
};

export const renderAccountLinks = Effect.fn("test.renderAccountLinks")(
  function* renderAccountLinks(
    page: "conferencing" | "calendar",
    width: number,
    theme: "light" | "dark" = "light"
  ) {
    const model = accountLinksFixture(page, width, theme);
    const fs = yield* FileSystem.FileSystem;
    const css = yield* fs.readFileString("src/client/style.css");

    const rendered = yield* renderToString(
      { init: () => ({ model }), view },
      { isHydratable: false }
    );

    return { css, html: rendered.html, model };
  },
  Effect.provide(NodeServices.layer)
);

const widthRules = (rules: CSSRuleList, width: number): readonly string[] =>
  [...rules].flatMap((rule) => {
    if (rule instanceof CSSMediaRule) {
      const maximum = /max-width:\s*(?<pixels>\d+)px/u.exec(rule.conditionText);
      const minimum = /min-width:\s*(?<pixels>\d+)px/u.exec(rule.conditionText);

      const withinMaximum =
        maximum === null || width <= Number(maximum.groups?.pixels);

      const withinMinimum =
        minimum === null || width >= Number(minimum.groups?.pixels);

      return (maximum !== null || minimum !== null) &&
        withinMaximum &&
        withinMinimum
        ? widthRules(rule.cssRules, width)
        : [];
    }

    return rule instanceof CSSStyleRule ? [rule.cssText] : [];
  });

const stylesheetWidthRules = (css: string, width: number) => {
  const source = document.createElement("style");
  source.textContent = css;
  document.head.append(source);

  try {
    if (source.sheet === null) {
      throw new Error("Account link source stylesheet is missing");
    }

    return widthRules(source.sheet.cssRules, width);
  } finally {
    source.remove();
  }
};

export const mountAccountLinksCss = Effect.fn("test.mountAccountLinksCss")(
  function* mountAccountLinksCss(
    page: "conferencing" | "calendar",
    width: number
  ) {
    const rendered = yield* renderAccountLinks(page, width);
    const root = document.createElement("div");
    root.innerHTML = rendered.html;

    const styles = [
      rendered.css,
      ...[...root.querySelectorAll("style")].map((style) => style.textContent),
    ];

    const flattened = styles.flatMap((css) => stylesheetWidthRules(css, width));

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const policy = document.createElement("style");
        policy.textContent = flattened.join("\n");
        document.head.append(policy);
        document.body.append(root);

        return policy;
      }),
      (policy) =>
        Effect.sync(() => {
          root.remove();
          policy.remove();
        })
    );

    return root;
  }
);

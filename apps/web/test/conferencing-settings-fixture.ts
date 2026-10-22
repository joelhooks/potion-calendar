import { expect } from "@effect/vitest";
import { Option, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { SaveCustomVideoLinks } from "../src/client/settings/conferencing/commands.js";
import {
  ConferencingSettingsChange as Change,
  CustomVideoWrite,
  initialConferencingSettings,
} from "../src/client/settings/conferencing/model.js";
import { SettingsRoute } from "../src/layout/route.js";
import { fixtureModel } from "./fixture.js";

export const conferencingSettingsScenarios = [
  "empty",
  "list",
  "add",
  "edit",
  "invalid",
  "required",
  "save-failure",
  "remove",
  "https-prepend",
  "pending",
] as const;

export type ConferencingSettingsScenario =
  (typeof conferencingSettingsScenarios)[number];

const saved = [
  { id: "team", link: "https://meet.example/team", name: "Team room" },
  {
    id: "design",
    link: "https://video.example/design",
    name: "Design reviews",
  },
];

const added = {
  id: "daily",
  link: "https://daily.example/standup",
  name: "Daily  Standup",
};

const rejectedScheme = "javascript";

const fill = [
  Change.cases.Add.make({}),
  Change.cases.Name.make({ value: "  Daily  Standup  " }),
  Change.cases.Link.make({ value: "daily.example/standup" }),
  Change.cases.Save.make({}),
];

const scripts: Record<
  ConferencingSettingsScenario,
  readonly (typeof Change.Type)[]
> = {
  add: [Change.cases.Add.make({})],
  edit: [Change.cases.Edit.make({ id: "team" })],
  empty: [],
  "https-prepend": [
    ...fill,
    Change.cases.Saved.make({ entries: [added], requestId: 1 }),
  ],
  invalid: [
    Change.cases.Add.make({}),
    Change.cases.Name.make({ value: "Daily Standup" }),
    Change.cases.Link.make({ value: `${rejectedScheme}:alert(1)` }),
    Change.cases.Save.make({}),
  ],
  list: [],
  pending: fill,
  remove: [
    Change.cases.Remove.make({ id: "team" }),
    Change.cases.Saved.make({
      entries: saved.filter((entry) => entry.id !== "team"),
      requestId: 1,
    }),
  ],
  required: [Change.cases.Add.make({}), Change.cases.Save.make({})],
  "save-failure": [
    ...fill,
    Change.cases.Failed.make({
      message:
        "Custom video link could not be saved. Your changes are still here.",
      requestId: 1,
    }),
  ],
};

const descriptor = Schema.Struct({
  args: Schema.Struct({
    personId: Schema.String,
    requestId: Schema.Int,
    write: CustomVideoWrite,
  }),
  name: Schema.Literal(SaveCustomVideoLinks.name),
});

export const conferencingSettingsFixture = (
  scenario: ConferencingSettingsScenario
) => {
  const base = fixtureModel();
  const seeded = ["list", "edit", "remove"].includes(scenario);

  let model: AppModel = {
    ...base,
    conferencingSettings: {
      ...initialConferencingSettings(),
      entries: seeded ? saved : [],
    },
    route: SettingsRoute.make({ page: "conferencing" }),
  };

  const personId = Option.getOrThrow(model.person);
  const writes: (typeof descriptor.Type)[] = [];

  for (const change of scripts[scenario]) {
    const result = update(
      model,
      Message.ChangedConferencingSettings({ change, personId })
    );

    for (const command of result.commands ?? []) {
      if (command.name === SaveCustomVideoLinks.name) {
        writes.push(Schema.decodeUnknownSync(descriptor)(command));
      }
    }

    ({ model } = result);
  }

  expect(writes).toHaveLength(
    ["https-prepend", "save-failure", "pending", "remove"].includes(scenario)
      ? 1
      : 0
  );

  if (scenario === "https-prepend") {
    expect(writes[0]?.args.write).toEqual(
      CustomVideoWrite.cases.Save.make({
        id: Option.none(),
        link: added.link,
        name: added.name,
      })
    );
  }

  const state = model.conferencingSettings;

  return {
    evidence: {
      actions: scripts[scenario],
      draft: {
        id: Option.getOrNull(state.draft.id),
        link: state.draft.link,
        name: state.draft.name,
      },
      entries: state.entries,
      error: Option.getOrNull(state.error),
      errors: {
        link: Option.getOrNull(state.errors.link),
        name: Option.getOrNull(state.errors.name),
      },
      mode: state.mode,
      scenario,
      storageResults:
        "Explicit deterministic storage-result stand-ins; real storage commands are qualified separately",
      writes,
    },
    model,
  };
};

import { Option, Predicate } from "effect";
import { AsyncData } from "foldkit";

import { visibleEvents } from "../../layout/presentation.js";
import type { MinuteRange } from "../../layout/time-blocks.js";
import type { AppModel } from "../app.js";
import { monthHostKey } from "../month/host.js";
import { timeGridGeometry } from "../time-blocks/grid.js";
import { EditorView } from "./editor-model.js";
import { gestureTarget } from "./gesture-input.js";
import type { GestureTarget } from "./gesture-model.js";

type Targets = readonly (typeof GestureTarget.Type)[];

type Reader = () => Targets | undefined;

interface Entry {
  readonly host: Element;
  readonly read: Reader;
}

export interface GestureTargetRegistry {
  readonly count: () => number;
  readonly read: (key: string, host: Element) => Targets | undefined;
  readonly register: (key: string, host: Element, read: Reader) => () => void;
  readonly releaseHost: (key: string, host: Element) => void;
}

export const gestureTargetRegistry = (): GestureTargetRegistry => {
  const entries = new Map<string, Entry>();

  return {
    count: () => entries.size,
    read: (key, host) => {
      const entry = entries.get(key);

      return entry?.host === host ? entry.read() : undefined;
    },
    register: (key, host, read) => {
      const entry = { host, read };
      entries.set(key, entry);

      return () => {
        if (entries.get(key) === entry) {
          entries.delete(key);
        }
      };
    },
    releaseHost: (key, host) => {
      if (entries.get(key)?.host === host) {
        entries.delete(key);
      }
    },
  };
};

export const gestureHostKey = (
  person: string,
  zone: string,
  scale: number,
  hidden: readonly (typeof MinuteRange.Type)[] = []
): string =>
  JSON.stringify([
    person,
    zone,
    scale,
    ...(hidden.length === 0 ? [] : [hidden]),
  ]);

export const modelGestureHostKey = (model: AppModel): Option.Option<string> =>
  model.calendar.navigation.mode === "month"
    ? monthHostKey(model)
    : model.person.pipe(
        Option.map((person) => {
          const { grid, scale } = timeGridGeometry(model);

          return gestureHostKey(
            person,
            model.calendar.zone,
            scale,
            grid.hidden
          );
        })
      );

const authenticated = (model: AppModel): boolean =>
  Option.match(AsyncData.getData(model.session), {
    onNone: () => false,
    onSome: (session) =>
      session !== null && Option.contains(model.person, session.user.id),
  });

export const acceptsGesture = (
  model: AppModel,
  personId: string,
  hostKey: string | undefined
): boolean =>
  authenticated(model) &&
  Predicate.isTagged(model.route, "Calendar") &&
  Option.contains(model.person, personId) &&
  (hostKey === undefined ||
    Option.contains(modelGestureHostKey(model), hostKey));

export const modelGestureInputs = (model: AppModel) => {
  const active =
    authenticated(model) &&
    EditorView.guards.Closed(model.editing.view) &&
    Predicate.isTagged(model.route, "Calendar");

  return {
    key: active ? modelGestureHostKey(model) : Option.none(),
    targets: active
      ? visibleEvents(model).flatMap((item) =>
          Option.toArray(gestureTarget(item, model.calendar.zone))
        )
      : [],
  };
};

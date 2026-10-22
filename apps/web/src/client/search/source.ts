import { Option, Predicate, Schema } from "effect";

import type { AppModel } from "../app.js";
import { SearchTask } from "./model.js";

const scopeKey = (
  personId: string | undefined,
  query: string,
  timeZone: string,
  weekStartsOn: number
): string => JSON.stringify([personId, query, timeZone, weekStartsOn]);

export const searchScope = (model: AppModel): string =>
  scopeKey(
    Option.getOrUndefined(model.person),
    model.search.text,
    model.calendar.zone,
    model.calendar.navigation.weekStartsOn ?? 0
  );

export const searchTaskScope = (task: typeof SearchTask.Type): string =>
  scopeKey(
    task.personId,
    task.request.query,
    task.request.timeZone,
    task.request.weekStartsOn
  );

export const searchTask = (
  model: AppModel
): Option.Option<typeof SearchTask.Type> =>
  Option.isSome(model.person) && Predicate.isTagged(model.route, "Search")
    ? Option.some({
        personId: model.person.value,
        request: {
          continuation:
            model.search.responseScope === searchScope(model)
              ? model.search.continuation
              : undefined,
          query: model.search.text,
          timeZone: model.calendar.zone,
          weekStartsOn: Schema.decodeUnknownSync(
            SearchTask.fields.request.fields.weekStartsOn
          )(model.calendar.navigation.weekStartsOn ?? 0),
        },
        revision: model.search.revision,
      })
    : Option.none();

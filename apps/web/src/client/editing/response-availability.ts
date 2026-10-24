import { Option } from "effect";

import type { AppModel } from "../app.js";
import { BulkView } from "../bulk/model.js";

export const responseIsBusy = (model: AppModel): boolean =>
  Option.isSome(model.editing.rsvp.saving) ||
  BulkView.guards.Running(model.editing.bulk) ||
  BulkView.guards.Undoing(model.editing.bulk);

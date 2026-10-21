import { Schema } from "effect";

import {
  EditorMutation,
  EditorRequest,
} from "../editing/editor-session-model.js";
import { ClipboardMemberIssue } from "./model.js";

export const ClipboardGroupRequest = Schema.Struct({
  key: Schema.NonEmptyString,
  request: EditorRequest.cases.New,
  title: Schema.String,
});

export const ClipboardGroupPreparation = Schema.Struct({
  issues: Schema.Array(ClipboardMemberIssue),
  requests: Schema.Array(ClipboardGroupRequest),
});

export const ClipboardGroupResult = Schema.Struct({
  issues: Schema.Array(ClipboardMemberIssue),
  mutations: Schema.Array(EditorMutation.cases.Saved),
});

import type { SessionSnapshot } from "@calendar/core/contracts";
import { Option, Predicate } from "effect";
import { AsyncData } from "foldkit";

import { CalendarRoute } from "../../../layout/route.js";
import type { AppModel, update } from "../../app.js";
import { Message } from "../../message.js";
import { profileRoute } from "../profile/model.js";
import { RunAccountDeletion } from "./commands.js";
import { stepAccountDeletion } from "./machine.js";
import { AccountDeletionChange, initialAccountDeletion } from "./model.js";
import type { AccountDeletionReply } from "./model.js";

type Result = ReturnType<typeof update>;

export const deletionAfterSession = (
  model: AppModel,
  snapshot: typeof SessionSnapshot.Type
) => {
  if (snapshot === null) {
    return model.accountDeletion.mode === "deleting" ||
      model.accountDeletion.mode === "deleted"
      ? model.accountDeletion
      : initialAccountDeletion(model.accountDeletion.sequence + 1);
  }

  return Option.contains(model.person, snapshot.user.id)
    ? model.accountDeletion
    : initialAccountDeletion(model.accountDeletion.sequence + 1);
};

export const changeAccountDeletion = (
  model: AppModel,
  personId: string,
  change: typeof AccountDeletionChange.Type
): Result => {
  if (!profileRoute(model.route) || !Option.contains(model.person, personId)) {
    return { model };
  }

  const previous = model.accountDeletion;

  if (AccountDeletionChange.guards.Open(change)) {
    const snapshot = Option.getOrUndefined(AsyncData.getData(model.session));

    if (
      previous.mode !== "closed" ||
      model.profile.mode === "saving" ||
      model.profile.mode === "confirming" ||
      snapshot === undefined ||
      snapshot === null ||
      snapshot.user.id !== personId ||
      snapshot.accountDeletionProof === undefined
    ) {
      return { model };
    }

    return {
      model: {
        ...model,
        accountDeletion: stepAccountDeletion(previous, {
          personId,
          proof: snapshot.accountDeletionProof,
          type: "Open",
        }),
      },
    };
  }

  if (
    !Option.contains(previous.personId, personId) ||
    Option.isNone(previous.proof)
  ) {
    return { model };
  }

  const state = stepAccountDeletion(previous, { type: change._tag });

  if (state.mode === "deleting" && previous.mode !== "deleting") {
    return {
      commands: [
        RunAccountDeletion({
          personId,
          proof: previous.proof.value,
          sequence: state.sequence,
        }),
      ],
      model: { ...model, accountDeletion: state },
    };
  }

  return { model: { ...model, accountDeletion: state } };
};

export const completeAccountDeletion = (
  model: AppModel,
  personId: string,
  sequence: number,
  reply: typeof AccountDeletionReply.Type,
  apply: typeof update
): Result => {
  const state = model.accountDeletion;

  if (
    state.mode !== "deleting" ||
    !Option.contains(state.personId, personId) ||
    state.sequence !== sequence ||
    (Option.isSome(model.person) && model.person.value !== personId)
  ) {
    return { model };
  }

  if (Predicate.isTagged(reply, "Failed")) {
    return {
      model: {
        ...model,
        accountDeletion: stepAccountDeletion(state, { type: "Failed" }),
      },
    };
  }

  const cleared = apply(model, Message.ReceivedSession({ snapshot: null }));

  const next = {
    ...cleared.model,
    accountDeletion: stepAccountDeletion(state, { type: "Deleted" }),
  };

  return apply(
    next,
    Message.RequestedRoute({ replace: true, route: CalendarRoute.make({}) })
  );
};

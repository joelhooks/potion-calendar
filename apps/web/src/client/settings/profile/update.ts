import { normalizeProfileName } from "@calendar/auth/contracts";
import { Option, Predicate } from "effect";
import { AsyncData } from "foldkit";

import { primaryAccountId } from "../../../layout/primary-account.js";
import type { AppModel, update } from "../../app.js";
import { Message } from "../../message.js";
import type { AppMessage } from "../../message.js";
import { routeFromUrl } from "../../routing.js";
import { RunProfileRequest } from "./commands.js";
import { changeProfile, stepProfile } from "./machine.js";
import {
  initialProfile,
  ProfileExit,
  ProfileWork,
  profileDirty,
  profileRoute,
} from "./model.js";
import type { ProfileChange, ProfileReply, ProfileUi } from "./model.js";

type Result = ReturnType<typeof update>;

const requestedExit = (
  message: AppMessage
): Option.Option<typeof ProfileExit.Type> => {
  if (Predicate.isTagged(message, "RequestedRouteBack")) {
    return Option.some(ProfileExit.cases.Back.make({}));
  }

  if (
    Predicate.isTagged(message, "RequestedRoute") &&
    !profileRoute(message.route)
  ) {
    return Option.some(
      ProfileExit.cases.Route.make({
        replace: message.replace,
        route: message.route,
      })
    );
  }

  if (
    Predicate.isTagged(message, "BrowserUrlRequested") &&
    (!Predicate.isTagged(message.request, "Internal") ||
      !profileRoute(routeFromUrl(message.request.url)))
  ) {
    return Option.some(
      ProfileExit.cases.Url.make({ request: message.request })
    );
  }

  return Option.none();
};

export const guardProfileExit = (
  model: AppModel,
  message: AppMessage
): Option.Option<Result> => {
  const exit = requestedExit(message);

  if (
    !profileRoute(model.route) ||
    !profileDirty(model.profile) ||
    Option.isNone(exit)
  ) {
    return Option.none();
  }

  return Option.some({
    model:
      model.profile.mode === "confirming"
        ? model
        : {
            ...model,
            profile: stepProfile(model.profile, {
              exit: exit.value,
              type: "Leave",
            }),
          },
  });
};

const performExit = (
  model: AppModel,
  exit: typeof ProfileExit.Type,
  apply: typeof update
): Result =>
  ProfileExit.match(exit, {
    Back: () => apply(model, Message.RequestedRouteBack()),
    Route: ({ replace, route }) =>
      apply(model, Message.RequestedRoute({ replace, route })),
    Url: ({ request }) =>
      apply(model, Message.BrowserUrlRequested({ request })),
  });

export const updateProfile = (
  model: AppModel,
  personId: string,
  change: typeof ProfileChange.Type,
  apply: typeof update
): Result => {
  if (
    !profileRoute(model.route) ||
    !Option.contains(model.person, personId) ||
    !Option.contains(model.profile.personId, personId)
  ) {
    return { model };
  }

  const previous = model.profile;
  const profile = changeProfile(previous, change);
  const next = { ...model, profile };

  if (
    Predicate.isTagged(change, "Discard") &&
    previous.mode === "confirming" &&
    Option.isSome(previous.exit)
  ) {
    return performExit(next, previous.exit.value, apply);
  }

  if (profile.sequence !== previous.sequence && profile.mode === "loading") {
    return {
      commands: [
        RunProfileRequest({
          personId,
          sequence: profile.sequence,
          work: ProfileWork.cases.Read.make({}),
        }),
      ],
      model: next,
    };
  }

  if (profile.sequence !== previous.sequence && profile.mode === "saving") {
    return Option.match(normalizeProfileName(profile.draft), {
      onNone: () => ({ model }),
      onSome: (name) => {
        const primary = Option.getOrUndefined(profile.draftPrimaryAccountId);
        const fields = { name, proof: profile.proof };

        const work =
          primary === undefined ||
          primary === Option.getOrUndefined(profile.savedPrimaryAccountId)
            ? ProfileWork.cases.Save.make(fields)
            : ProfileWork.cases.Save.make({
                ...fields,
                primaryAccountId: primary,
              });

        return {
          commands: [
            RunProfileRequest({ personId, sequence: profile.sequence, work }),
          ],
          model: next,
        };
      },
    });
  }

  return { model: next };
};

export const completeProfile = (
  model: AppModel,
  personId: string,
  sequence: number,
  reply: typeof ProfileReply.Type
): Result => {
  const state = model.profile;

  if (
    !profileRoute(model.route) ||
    !Option.contains(model.person, personId) ||
    !Option.contains(state.personId, personId) ||
    state.sequence !== sequence
  ) {
    return { model };
  }

  if (Predicate.isTagged(reply, "Loaded") && state.mode === "loading") {
    if (reply.snapshot === null || reply.snapshot.user.id !== personId) {
      return {
        model: {
          ...model,
          profile: stepProfile(state, {
            message: "Your session changed. Reload to continue.",
            type: "Failed",
          }),
        },
      };
    }

    return {
      model: {
        ...model,
        profile: stepProfile(state, {
          accounts: reply.snapshot.accounts,
          name: reply.snapshot.user.name,
          primaryAccountId: Option.fromNullishOr(
            primaryAccountId(reply.snapshot)
          ),
          proof: reply.snapshot.profileUpdateProof ?? "",
          type: "Loaded",
        }),
        session: AsyncData.Success({ data: reply.snapshot }),
      },
    };
  }

  if (Predicate.isTagged(reply, "Saved") && state.mode === "saving") {
    const snapshot = Option.getOrUndefined(AsyncData.getData(model.session));

    let { session } = model;

    if (
      snapshot !== undefined &&
      snapshot !== null &&
      snapshot.user.id === personId
    ) {
      const renamed = { ...snapshot.user, name: reply.name };

      const user =
        reply.primaryAccountId === undefined
          ? renamed
          : { ...renamed, primaryAccountId: reply.primaryAccountId };

      session = AsyncData.Success({ data: { ...snapshot, user } });
    }

    return {
      model: {
        ...model,
        profile: stepProfile(state, {
          name: reply.name,
          primaryAccountId:
            reply.primaryAccountId === undefined
              ? state.draftPrimaryAccountId
              : Option.fromNullishOr(
                  primaryAccountId(
                    Option.getOrUndefined(AsyncData.getData(session))
                  )
                ),
          type: "Saved",
        }),
        session,
      },
    };
  }

  return Predicate.isTagged(reply, "Failed") &&
    (state.mode === "loading" || state.mode === "saving")
    ? {
        model: {
          ...model,
          profile: stepProfile(state, {
            message: reply.message,
            type: "Failed",
          }),
        },
      }
    : { model };
};

export const synchronizeProfile = (result: Result): Result => {
  const { model } = result;

  if (!profileRoute(model.route) || Option.isNone(model.person)) {
    return model.profile.mode === "idle"
      ? result
      : {
          ...result,
          model: {
            ...model,
            profile: initialProfile(model.profile.sequence + 1),
          },
        };
  }

  if (
    Option.contains(model.profile.personId, model.person.value) &&
    model.profile.mode !== "idle"
  ) {
    return result;
  }

  const snapshot = Option.getOrUndefined(AsyncData.getData(model.session));

  if (
    snapshot === undefined ||
    snapshot === null ||
    snapshot.user.id !== model.person.value
  ) {
    return result;
  }

  const profile: typeof ProfileUi.Type = {
    ...initialProfile(model.profile.sequence + 1),
    draft: snapshot.user.name,
    mode: "loading",
    personId: model.person,
    savedName: snapshot.user.name,
  };

  return {
    ...result,
    commands: [
      ...(result.commands ?? []),
      RunProfileRequest({
        personId: model.person.value,
        sequence: profile.sequence,
        work: ProfileWork.cases.Read.make({}),
      }),
    ],
    model: { ...model, profile },
  };
};

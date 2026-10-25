import type { D1Database } from "@cloudflare/workers-types";
import {
  createAuthEndpoint,
  getSessionFromCtx,
  sessionMiddleware,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { Schema } from "effect";

const Grant = Schema.Struct({
  personId: Schema.String,
  sessionToken: Schema.String,
});

const GrantRow = Schema.Struct({ value: Schema.String });

export interface DesktopGrant {
  readonly personId: string;
  readonly sessionToken: string;
}

export interface DesktopHandoffStore {
  readonly issue: (
    identifier: string,
    grant: DesktopGrant,
    now: number
  ) => Promise<boolean>;
  readonly consume: (
    identifier: string,
    now: number
  ) => Promise<DesktopGrant | null>;
}

export const desktopHandoffStore = (
  database: D1Database
): DesktopHandoffStore => ({
  // @effect-diagnostics-next-line asyncFunction:off -- One D1 DELETE RETURNING statement owns consumption; no read and delete race.
  consume: async (identifier, now) => {
    const row = await database
      .prepare(
        'DELETE FROM verification WHERE identifier = ? AND "expiresAt" > ? RETURNING value'
      )
      .bind(identifier, now)
      .first();

    if (row === null) {
      return null;
    }

    const stored = Schema.decodeUnknownSync(GrantRow)(row);

    return Schema.decodeSync(Schema.fromJsonString(Grant))(stored.value);
  },
  // @effect-diagnostics-next-line asyncFunction:off -- Better Auth invokes this D1 adapter through its native Promise plugin boundary.
  issue: async (identifier, grant, now) => {
    try {
      await database
        .prepare(
          'INSERT INTO verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?)'
        )
        .bind(
          identifier,
          identifier,
          JSON.stringify(grant),
          now + 120_000,
          now,
          now
        )
        .run();

      return true;
    } catch {
      return false;
    }
  },
});

const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));

  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

// @effect-diagnostics-next-line asyncFunction:off -- The WebCrypto digest is a native Promise boundary used by the Better Auth plugin.
const identifierFor = async (token: string) => {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );

  return `calendar-desktop:${[...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
};

export const desktopHandoff = (
  store: DesktopHandoffStore,
  allowed: (email: string) => boolean
) => ({
  endpoints: {
    issueDesktopToken: createAuthEndpoint(
      "/desktop/issue",
      {
        method: "GET",
        use: [sessionMiddleware],
      },
      // @effect-diagnostics-next-line asyncFunction:off -- Better Auth owns endpoint execution and cookie signing.
      async (context) => {
        const current = context.context.session;

        if (!allowed(current.user.email)) {
          throw context.error("FORBIDDEN", {
            message: "Desktop sign-in refused",
          });
        }

        const token = randomToken();

        // @effect-diagnostics-next-line globalDate:off -- Better Auth uses wall-clock epoch milliseconds for its persistent verification and session deadlines.
        const now = Date.now();

        const stored = await store.issue(
          await identifierFor(token),
          { personId: current.user.id, sessionToken: current.session.token },
          now
        );

        if (!stored) {
          throw context.error("FORBIDDEN", {
            message: "Desktop sign-in refused",
          });
        }

        return await context.json({ token });
      }
    ),
    redeemDesktopToken: createAuthEndpoint(
      "/desktop/redeem",
      { method: "GET" },
      // @effect-diagnostics-next-line asyncFunction:off -- Better Auth owns endpoint execution and its native session-cookie helper.
      async (context) => {
        const token =
          context.request === undefined
            ? null
            : new URL(context.request.url).searchParams.get("token");

        if (token === null || !/^[a-f0-9]{64}$/u.test(token)) {
          throw context.error("BAD_REQUEST", {
            message: "Desktop sign-in refused",
          });
        }

        // @effect-diagnostics-next-line globalDate:off -- Persistent grant expiry shares Better Auth's wall-clock session time base.
        const now = Date.now();
        const grant = await store.consume(await identifierFor(token), now);

        if (grant === null) {
          throw context.error("BAD_REQUEST", {
            message: "Desktop sign-in refused",
          });
        }

        const session = await context.context.internalAdapter.findSession(
          grant.sessionToken
        );

        const existing = await getSessionFromCtx(context, {
          disableCookieCache: true,
          disableRefresh: true,
        });

        if (
          session === null ||
          session.user.id !== grant.personId ||
          session.session.userId !== grant.personId ||
          session.session.expiresAt.getTime() <= now ||
          !session.user.emailVerified ||
          !allowed(session.user.email) ||
          (existing !== null && existing.user.id !== grant.personId)
        ) {
          throw context.error("FORBIDDEN", {
            message: "Desktop sign-in refused",
          });
        }

        await setSessionCookie(context, session);

        return await context.json({ success: true });
      }
    ),
  },
  id: "calendar-desktop",
});

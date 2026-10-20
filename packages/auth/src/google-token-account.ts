import { Schema } from "effect";

export const GoogleTokenAccount = Schema.Struct({
  accessToken: Schema.NullOr(Schema.String),
  accessTokenExpiresAt: Schema.NullOr(Schema.Date),
  disconnected: Schema.Boolean,
  googleEmail: Schema.String,
  id: Schema.String,
  refreshToken: Schema.NullOr(Schema.String),
});

export type TokenAccount = typeof GoogleTokenAccount.Type;

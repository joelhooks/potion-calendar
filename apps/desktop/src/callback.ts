import { Option, Schema } from "effect";

export const Callback = Schema.Struct({
  state: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
  token: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
});

export const parseCallback = (target: string, host: string, state: string) => {
  const url = URL.parse(target, `http://${host}`);

  if (
    url === null ||
    url.origin !== `http://${host}` ||
    url.pathname !== "/callback" ||
    url.searchParams.getAll("state").length !== 1 ||
    url.searchParams.getAll("token").length !== 1
  ) {
    return null;
  }

  const decoded = Schema.decodeUnknownOption(Callback)({
    state: url.searchParams.get("state"),
    token: url.searchParams.get("token"),
  });

  return Option.isSome(decoded) && decoded.value.state === state
    ? decoded.value.token
    : null;
};

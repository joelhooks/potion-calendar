export const keepaliveFetch = (fetcher: typeof fetch): typeof fetch => {
  // @effect-diagnostics-next-line asyncFunction:off -- The native keepalive request must outlive application-scope cancellation.
  const detached: typeof fetch = async (input, init) =>
    await fetcher(input, { ...init, keepalive: true, signal: null });

  return detached;
};

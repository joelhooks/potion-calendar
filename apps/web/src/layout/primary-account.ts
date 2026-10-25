import type { SessionSnapshot } from "@calendar/core/contracts";

export const primaryAccountId = (
  session: typeof SessionSnapshot.Type | undefined
): string | undefined => {
  const accounts = session?.accounts ?? [];
  const selected = session?.user.primaryAccountId;

  return (
    accounts.find((account) => account.id === selected)?.id ??
    accounts.find((account) => account.email === session?.user.email)?.id ??
    accounts[0]?.id
  );
};

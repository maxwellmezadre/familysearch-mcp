// Who the token belongs to. `GET /platform/users/current` is the only call
// that cannot go through the normal http layer: it is how a token is proven
// (and its environment told apart) BEFORE there is a session to queue under.

export type FsUser = { id: string; displayName: string; personId: string | null };

type CurrentUser = {
  users?: Array<{ id?: string; displayName?: string; contactName?: string; personId?: string }>;
};

/**
 * One direct request. `null` when FamilySearch rejects the token (401/403);
 * throws on anything else, so a network failure is never read as "logged out".
 */
export async function probeUser(
  baseUrl: string,
  token: string,
  userAgent: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FsUser | null> {
  const response = await fetchImpl(`${baseUrl}/platform/users/current`, {
    method: "GET",
    redirect: "manual",
    headers: {
      authorization: `Bearer ${token}`,
      "user-agent": userAgent,
      accept: "application/x-fs-v1+json",
    },
  });
  if (response.status === 401 || response.status === 403) return null;
  if (response.status !== 200) {
    throw new Error(`FamilySearch respondeu ${response.status} em users/current.`);
  }
  const user = ((await response.json()) as CurrentUser).users?.[0];
  if (!user?.id) throw new Error("FamilySearch respondeu users/current sem usuário.");
  return {
    id: user.id,
    displayName: user.displayName ?? user.contactName ?? "usuário do FamilySearch",
    personId: user.personId ?? null,
  };
}

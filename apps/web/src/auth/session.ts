/**
 * The API answers 401 when a session ends server-side: the account was disabled,
 * the password was reset, or the cookie expired. Every fetch helper calls this so
 * AuthProvider can sign the user out instead of leaving them on a broken page.
 * Sign-in attempts are excluded: a wrong password is a 401 too, but not a lost session.
 */
export const SESSION_ENDED_EVENT = "mv:session-ended";

export function noteResponseStatus(status: number, path = ""): void {
  if (status !== 401) return;
  if (path.startsWith("/auth/login") || path.startsWith("/auth/google") || path.startsWith("/auth/me")) return;
  window.dispatchEvent(new Event(SESSION_ENDED_EVENT));
}

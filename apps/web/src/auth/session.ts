/**
 * The API answers 401 when a session ends server-side: the account was disabled,
 * the password was reset, or the token expired. Every fetch helper calls this so
 * AuthProvider can sign the user out instead of leaving them on a broken page.
 */
export const SESSION_ENDED_EVENT = "mv:session-ended";

export function noteResponseStatus(status: number): void {
  if (status !== 401) return;
  try {
    if (!localStorage.getItem("mv_token")) return;
  } catch {
    return;
  }
  window.dispatchEvent(new Event(SESSION_ENDED_EVENT));
}

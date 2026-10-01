/** Drop into pages/SignUp.tsx (or Onboarding.tsx). Controlled; POST the values to /api/onboarding/register. */
export type WorkspaceMode = "create" | "join";
export interface WorkspaceValue { mode: WorkspaceMode; orgName: string; inviteCode: string }

export default function WorkspaceChoice({ value, onChange }: { value: WorkspaceValue; onChange: (v: WorkspaceValue) => void }) {
  const set = (patch: Partial<WorkspaceValue>) => onChange({ ...value, ...patch });
  return (
    <fieldset style={{ border: 0, padding: 0, display: "grid", gap: 10 }}>
      <legend style={{ fontWeight: 600, marginBottom: 6 }}>Workspace</legend>
      <label className={`mv-radio ${value.mode === "create" ? "on" : ""}`}>
        <input type="radio" name="ws" checked={value.mode === "create"} onChange={() => set({ mode: "create" })} />
        <span>Create new workspace</span>
      </label>
      {value.mode === "create" && (
        <input className="mv-input" placeholder="Workspace name" value={value.orgName} onChange={(e) => set({ orgName: e.target.value })} required />
      )}
      <label className={`mv-radio ${value.mode === "join" ? "on" : ""}`}>
        <input type="radio" name="ws" checked={value.mode === "join"} onChange={() => set({ mode: "join" })} />
        <span>Join existing workspace with invite code</span>
      </label>
      {value.mode === "join" && (
        <>
          <input className="mv-input" placeholder="Invite code (or leave blank to match your work email domain)" value={value.inviteCode} onChange={(e) => set({ inviteCode: e.target.value })} />
          <span className="mv-muted">Domain matches need approval from a workspace owner.</span>
        </>
      )}
    </fieldset>
  );
}

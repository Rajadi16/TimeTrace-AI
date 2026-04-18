# TimeTrace AI V3 Demo Script

## 1) Workspace Layout And What Each File Demonstrates

- `src/controller/userController.ts`
  - Entry point for request handling.
  - DEMO: null guard removal.
  - Great for code pane before/after and file-line navigation.

- `src/service/userService.ts`
  - Business mapping from API response to UI-safe summary.
  - DEMO: optional chaining/fallback removal.
  - DEMO: TODO/hacky workaround expansion.

- `src/api/userApi.ts`
  - API boundary and exported contract.
  - DEMO: export signature break.
  - DEMO: cross-file dependency break from service call sites.

- `src/cache/userCache.ts`
  - Cache layer between API and DB.
  - DEMO: possible loop/performance risk expansion.

- `src/db/userDb.ts`
  - Small in-memory dataset.
  - Used to keep the flow realistic and traceable.

- `src/index.ts`
  - Simple runtime harness and top-level path.
  - Useful to show dependency graph breadth.

- `src/shared/types.ts`
  - Shared contracts across all layers.
  - Useful to discuss impacted files when signatures drift.

## 2) Recommended Demo Order

1. Baseline save pass
2. Null guard removal (controller)
3. Optional chaining/fallback removal + TODO workaround (service)
4. Export signature break (api)
5. Undefined identifier diagnostic error (service)
6. Performance-risk loop escalation (cache)
7. Fix forward to show incident lifecycle (open -> mitigated -> resolved)

## 3) Baseline Setup

1. Open the folder `demo-v3-workspace` in the same VS Code window.
2. Open files side-by-side:
   - `src/controller/userController.ts`
   - `src/service/userService.ts`
   - `src/api/userApi.ts`
   - `src/cache/userCache.ts`
3. Save each file once to establish baseline snapshots.

Expected TimeTrace behavior:
- Initial baseline/timeline entries appear.
- No severe incidents yet.

## 4) Exact Live Edits And Expected Behavior

### Step A: Null Guard Removal (single-file finding)

File: `src/controller/userController.ts`

Edit:
- Remove this block:

```ts
if (!summary || !summary.displayName) {
  return `[safe-fallback] ${auditLine}`;
}
```

Save file.

Expected behavior:
- New finding in controller around guard removal risk.
- Timeline checkpoint progression and before/after snippet visible.
- Root-cause candidates should include controller/service path.

### Step B: Optional Chaining/Fallback Removal + TODO Expansion (multiple findings in one file)

File: `src/service/userService.ts`

Edit 1:
- Change:

```ts
contactEmail: user.email?.toLowerCase() ?? "missing-email@demo.dev",
```

To:

```ts
contactEmail: user.email.toLowerCase(),
```

Edit 2:
- Replace the TODO comment block near `logUserRequest` with:

```ts
// TODO: quick demo hack; should be replaced with structured logger
// HACK: keep request labels short to reduce payload size for now
```

Save file.

Expected behavior:
- Multiple findings in one save (null-safe access removed + hacky comment signals).
- Stronger RCA around service as likely source.
- Code pane should highlight changed lines in service.

### Step C: Export Signature Break (multi-file impact + related/impacted)

File: `src/api/userApi.ts`

Edit function signature:

```ts
export function fetchUserRecord(userId: string): UserApiResponse {
```

To:

```ts
export function fetchUserRecord(userId: string, includeArchived: boolean): UserApiResponse {
```

Optional inside function:

```ts
if (!includeArchived && user?.isArchived) {
  return { source: "cache" };
}
```

Save file.

Expected behavior:
- Export signature change risk flagged.
- Related/impacted behavior should include service call sites.
- Inferred architecture path should make controller -> service -> api chain clear.

### Step D: Runtime Diagnostic Capture (real TypeScript diagnostic)

File: `src/service/userService.ts`

Edit:
- Introduce undefined identifier right before return, for example:

```ts
const debugMode = missingConfigFlag;
```

Save file.

Expected behavior:
- TypeScript diagnostic appears in editor.
- Runtime capture path ingests this diagnostic into RuntimeEvent pipeline.
- Runtime events/timeline update and incident evidence should include diagnostic-driven signal.

### Step E: Loop/Performance Risk Escalation

File: `src/cache/userCache.ts`

Edit:
- Inside `warmUserCache`, add one more nested loop to intentionally amplify complexity:

```ts
for (const user of allUsers) {
  for (const candidateA of allUsers) {
    for (const candidateB of allUsers) {
      if (!userCache.has(user.id)) {
        userCache.set(user.id, user);
      }
    }
  }
}
```

Save file.

Expected behavior:
- Heavier-loop/performance risk finding appears.
- RCA may shift or show multi-candidate ranking.

### Step F: Incident Lifecycle (resolve path)

Apply fixes in reverse:
1. Remove `missingConfigFlag` line.
2. Restore API signature to original one-arg form.
3. Restore optional chaining/fallback in service.
4. Restore safe guard in controller.
5. Revert loop to baseline two-level implementation.

Save after each fix.

Expected behavior:
- Incident status progression should move toward mitigated/resolved over subsequent saves.
- Timeline should show state transitions and shrinking evidence.

## 5) Demo Reliability Notes

- Keep edits small and save after each step.
- Avoid changing multiple files at once unless the step explicitly requests it.
- If timeline feels noisy, pause for a moment between saves to let analysis settle.

## 6) Quick One-Line Story For Audience

"We start from a safe baseline, introduce realistic regressions across controller/service/api/cache, watch TimeTrace AI connect findings and runtime diagnostics across files, then fix forward and observe incident lifecycle toward resolution."

## 7) Demo Reset Checklist

Use this when you want to restore the workspace before the next run:

1. Revert `src/controller/userController.ts` to keep the null guard.
2. Revert `src/service/userService.ts` to restore optional chaining and the original TODO comment.
3. Revert `src/api/userApi.ts` to the single-argument export signature.
4. Remove any intentional diagnostic error line from `src/service/userService.ts`.
5. Restore `src/cache/userCache.ts` to the baseline two-level loop.
6. Save each file once in the same order as the recommended demo flow.

Expected result after reset:
- The workspace returns to a clean baseline suitable for a fresh walkthrough.
- TimeTrace AI should show only baseline checkpoints until you reapply the demo edits.

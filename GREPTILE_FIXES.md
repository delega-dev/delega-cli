# Greptile P2 Fixes — PR #11

All 4 items from accumulated Greptile reviews on PR #10 that were deferred.
Branch: `fix/greptile-p2-cleanup`

## Fix 1: Add AbortSignal timeout to apiRequest fetch calls

**File:** `src/api.ts`

**Problem:** `apiRequest()` calls `fetch()` without any timeout. If the server hangs mid-response, the CLI hangs forever. The `status` command already uses `AbortSignal.timeout(10_000)` on its direct fetch calls, but every other command goes through `apiRequest` which has no timeout.

**Fix:** Add `signal: AbortSignal.timeout(15_000)` to the fetch call in `apiRequest()`. 15 seconds is generous enough for slow connections but prevents infinite hangs.

```typescript
// In apiRequest(), add signal to the fetch options:
const options: RequestInit = { method, headers, signal: AbortSignal.timeout(15_000) };
```

The existing `formatNetworkError()` already handles `TimeoutError` messages, so the error output will be correct automatically.

## Fix 2: Email validation in init hosted signup

**File:** `src/commands/init.ts`

**Problem:** During hosted signup, the user enters an email address and it's sent directly to the API with no client-side validation. If they typo it badly (e.g., no @ sign, empty string), they waste an API call and get a confusing server error.

**Fix:** Add a basic email format check after the email prompt, before calling the signup API. Keep it simple — just check for `x@y.z` pattern. If invalid, print a warning and re-prompt.

```typescript
// After reading email input, before the signup fetch:
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// In the hosted signup flow, after getting the email:
if (!isValidEmail(email)) {
  console.log(chalk.red("Invalid email format. Please try again."));
  // re-prompt or exit gracefully
}
```

Put the `isValidEmail` helper in `src/ui.ts` and export it so it can be reused.

## Fix 3: Bound total timeout for status command

**File:** `src/commands/status.ts`

**Problem:** The status command makes up to 3 sequential fetch calls (health, /agent/me, /stats), each with a 10-second timeout. Worst case, the command takes 30 seconds before showing any output if connections are stalling.

**Fix:** Use a shared AbortController with a single 15-second timeout for the entire status command sequence. All three fetch calls share this controller's signal. This way the total wall time is bounded to 15 seconds regardless of how many calls stall.

```typescript
// At the top of the action handler, after resolving apiUrl:
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 15_000);

// Replace all AbortSignal.timeout(10_000) with controller.signal:
// - health fetch: signal: controller.signal
// - /agent/me fetch: signal: controller.signal  
// - /stats fetch: signal: controller.signal

// At the end, before the output section:
clearTimeout(timeout);
```

## Fix 4: Docker image tag uses CLI version dynamically

**File:** `src/commands/init.ts`

**Problem:** Already fixed — `DELEGA_DOCKER_TAG` reads from `pkg.version`. However, the docker-compose template at `src/templates/docker-compose.yml` has a placeholder `__DELEGA_TAG__` that gets replaced. Verify this substitution actually works and the generated file uses the correct version. If the template uses a hardcoded tag instead of the placeholder, fix it.

**Verification:** Read `src/templates/docker-compose.yml` and confirm it uses `__DELEGA_TAG__` (or equivalent placeholder). If it already works correctly, skip this fix and note it in the PR description.

---

## Instructions

1. Create branch `fix/greptile-p2-cleanup` from `main`
2. Implement fixes 1-3 (verify fix 4, skip if already working)
3. Run `npm run build` to verify TypeScript compiles
4. Update CHANGELOG.md — add entries under `[Unreleased]`
5. Commit with message: `fix: greptile P2 cleanup — fetch timeout, email validation, status timeout bound`
6. Push and open PR against `main`
7. Do NOT merge — leave for review

## Testing notes

- Fix 1: Can't easily test timeout without a mock server, but verify the code compiles and the signal is passed
- Fix 2: Test by adding a quick check — `isValidEmail("bad")` returns false, `isValidEmail("a@b.com")` returns true
- Fix 3: Verify the shared controller pattern compiles and the clearTimeout is called on all exit paths

---
name: alibai
description: Run tests and record local evidence with Alibi for AI, including UI screenshots and logic outputs from base and current code. Use when asked to test with Alibai, for example "alibai로 테스트해줘".
---

## Start the run

```sh
alibai run start --title "Cart rounding" --platform web --base "$base_sha"
```

Run this in the Git checkout under test (head). Resolve the intended baseline to a local commit and substitute its SHA for `$base_sha`. If relying on the CLI default, omit `--base` and use `git.baseSha` from the reported `run.json` for comparisons. Keep all `alibai` commands in the head checkout. Use `--run <id>` for `step`, `check`, and `run end` if other runs may be open.

```sh
git worktree add --detach "$base_worktree" "$base_sha"
```

Use a fresh path outside the head checkout for `$base_worktree` to preserve current edits. Run the baseline there. If the baseline is unavailable, report the gap and record the current evidence you can verify.

## Record each UI action

```sh
alibai step --action "Open cart" --before "base cart.png" --after "head cart.png" \
  --note "The subtotal rounds to 130 cents." --result pass
```

Replay the same action from matching initial state on base and head. Capture the corresponding screen on each as `--before` (base) and `--after` (head). Quote paths with spaces. Relative screenshot paths resolve from the directory where you run `alibai step`. Use absolute paths for captures outside that directory. If only one side is available, pass its flag and explain the gap in `--note`. Each `step` needs at least one screenshot.

For Flutter device or simulator operations, use the `sim-use` skill and launch each checkout with `fvm flutter run`.

## Record each changed logic check

```sh
alibai check --target roundSubtotal --input '{"cents":125}' \
  --before 120 --after 130 --expected 130 --result pass
alibai check --target roundSubtotal --input '"invalid"' \
  --before null --expected null --error 'TypeError: cents must be a number' --result fail
```

Exercise base and head with the same input. Use actual JSON values for `--input`, `--before`, and `--after`, and add `--expected` when you know the expected result. Preserve JSON quotes inside shell quotes for strings. Use `--before=-1` for a negative number. If head throws, pass its exception name or message with `--error` and omit `--after`. The second example records an actual JSON `null` from base. If you cannot observe a required base value, report the gap.

## Finish and share the result

```sh
alibai run end --verdict fail --summary "Cart rounding passes, but invalid input throws instead of returning null."
```

For each item and the overall verdict, use `pass` when the expected behavior is verified, `fail` when observed behavior violates the expectation, and `info` for observations without a conclusive verdict. Give the requester the run ID, verdict, and one-line summary. Tell them to run `alibai open` from the head checkout to view the evidence.

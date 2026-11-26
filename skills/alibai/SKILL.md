---
name: alibai
description: Run tests and record local evidence with Alibi for AI, including UI screenshots and logic outputs from base and current code. Use when asked to test with Alibai, for example "alibai로 테스트해줘".
---

## Start the run

```sh
base_sha=$(git merge-base HEAD origin/main) &&
evidence_dir=$(mktemp -d "${TMPDIR:-/tmp}/alibai.XXXXXXXX") &&
base_worktree="$evidence_dir/base" &&
alibai run start --title "Cart rounding" --platform web --base "$base_sha" &&
git worktree add --detach "$base_worktree" "$base_sha"
```

Run from the root of the checkout under test (head) and use a temporary directory outside it. For a known pre-change commit, replace the first assignment with `base_sha=$(git rev-parse --verify 'YOUR_REF^{commit}')`, substituting the actual local ref. Use that same SHA for both the run and the detached worktree. If the baseline is unavailable, report the gap and record what you can verify on head.

Keep all `alibai` commands in the head checkout. Use `--run <id>` for `step`, `check`, and `run end` if other runs may be open.

## Record each UI action

```sh
(cd "$base_worktree" && npm ci && npm run dev)
```

Use the project's pinned tools and documented setup and start commands. The example starts an npm web app from its base worktree. Reproduce the action on base and save the screenshot to `$evidence_dir/base cart.png`. Stop base before starting head on the same device or port, or use separate devices or ports. Start head from its own checkout, replay the action from matching initial state, and save the screenshot to `$evidence_dir/head cart.png`.

For Flutter, follow the project's SDK and device instructions. Use `fvm flutter pub get` and `fvm flutter run` when the project uses FVM. Use `sim-use` for device or simulator operations when available. Otherwise use a platform capture tool such as `xcrun simctl io booted screenshot "$path"` on an iOS simulator or `adb exec-out screencap -p > "$path"` on Android, with `$path` set to the desired external PNG path. For web, use the browser's screenshot tool.

```sh
alibai step --action "Open cart" \
  --before "$evidence_dir/base cart.png" --after "$evidence_dir/head cart.png" \
  --note "The subtotal rounds to 130 cents." --result pass
```

Use distinct filenames for each action. Relative paths resolve from the directory where you run `alibai step`. If only one capture is available, pass its flag and explain the gap in `--note`. Each step needs at least one screenshot.

## Record each changed logic check

```sh
input='{"cents":125}'
probe='const { roundSubtotal } = require("./cart.cjs");
console.log(JSON.stringify(roundSubtotal(JSON.parse(process.argv[1]))));'
before=$(cd "$base_worktree" && node -e "$probe" "$input") &&
after=$(node -e "$probe" "$input") &&
alibai check --target roundSubtotal --input="$input" \
  --before="$before" --after="$after" --expected 130 --result pass
```

Use a throwaway command or focused test with each checkout's pinned tooling. This Node example imports the actual target in each checkout and prints its JSON result for the same input. Set `--result` from the observed output and add `--expected` when you know the expected value. Keep JSON strings quoted inside shell quotes.

```sh
alibai check --target roundSubtotal --input '"invalid"' \
  --before null --expected null --error 'TypeError: cents must be a number' --result fail
```

Run both probes again for an exception case. The example assumes base returned JSON `null` and head threw the shown error. For a head exception, pass the observed exception with `--error` and omit `--after`. If base throws or a required value is unavailable, describe the gap in the run summary. Use `null` only for an observed JSON null.

## Finish and share the result

```sh
alibai run end --verdict fail --summary "Cart rounding passes, but invalid input throws instead of returning null." &&
git worktree remove "$base_worktree"
```

Use `pass` for verified expectations, `fail` for observed mismatches, and `info` when an observation is inconclusive. Stop the base app before removing its clean worktree. Give the requester the run ID, verdict, and one-line summary, then tell them to run `alibai open` from head to view the evidence.

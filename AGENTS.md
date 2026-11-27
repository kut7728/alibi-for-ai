# Git contribution rules

## Commits

- Use Conventional Commits in English. Start the description after `type:` or `type(scope):` with a lowercase imperative verb and omit the final period.
- Use one of these types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`, `build`, `perf`.
- Scopes are optional. Omit the scope for repository-wide changes, for example `docs: add git contribution rules`.
- Example scopes include `cli`, `format`, `store`, `viewer`, `skill`, and `docs`.
- Use a different scope when useful.
- Keep commits small and coherent. Split implementation, tests, and docs where useful. Avoid WIP and generic review-fix subjects. Tidy the history before pushing.

## Branches

Use `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, or `chore/<slug>`.

## Pull requests

- Use the same Conventional Commits format for the English PR title. Use the PR title as the squash commit subject.
- Write the PR body in English with `Summary`, `Changes`, and `Testing` sections. In `Testing`, list the commands you ran and their outcomes. Include the optional `Screenshots` section only for UI changes.
- Answer each review item in a PR comment.
- Update `README.md`, `README.ko.md`, and `README.ja.md` together whenever you change the README.

## Merges and releases

- Squash merge only after explicit approval from the repository owner. Keep `main` linear with one commit per PR.
- Use SemVer tags and `CHANGELOG.md` for releases. Reserve `v0.1.0` for the completed MVP.

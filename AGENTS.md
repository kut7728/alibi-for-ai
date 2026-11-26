# Git contribution rules

## Commits

- Use Conventional Commits in English. Start the subject after `type(scope):` with a lowercase imperative verb and omit the final period. Example: `docs(docs): document git contribution rules`.
- Use one of these types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`, `build`, `perf`.
- Use one of these scopes: `cli`, `format`, `store`, `viewer`, `skill`, `docs`.
- Keep commits small and coherent. Split implementation, tests, and docs where useful. Avoid WIP and generic review-fix subjects. Tidy the history before pushing.

## Branches

Use `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, or `chore/<slug>`.

## Pull requests

- Use the same Conventional Commits format for the English PR title. Use the PR title as the squash commit subject.
- Write the PR body in English with `Summary`, `Changes`, and `Testing` sections. In `Testing`, list the commands you ran and their outcomes. Include the optional `Screenshots` section only for UI changes.
- Answer each review item in a PR comment.

## Merges and releases

- Squash merge only after explicit approval from the repository owner. Keep `main` linear with one commit per PR.
- Use SemVer tags and `CHANGELOG.md` for releases. Reserve `v0.1.0` for the completed MVP.

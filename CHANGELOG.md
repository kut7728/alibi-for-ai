# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-11-27

### Added

- Explore a sample case in the public GitHub Pages demo without installing the CLI. [#9](https://github.com/kut7728/alibi-for-ai/pull/9)
- Install the CLI from npm with `npm i -g alibai` or open the viewer with `npx alibai open`. [#11](https://github.com/kut7728/alibi-for-ai/pull/11)

### Changed

- Preview the viewer in the README with screenshots and a video, and use the project under the MIT license. [#10](https://github.com/kut7728/alibi-for-ai/pull/10)
- Publish npm releases with Trusted Publishing and provenance, and run tests and validate the viewer template before deploying the Pages demo. [#12](https://github.com/kut7728/alibi-for-ai/pull/12)
- Read the documentation in English, Korean, or Japanese, with English as the default README. [#13](https://github.com/kut7728/alibi-for-ai/pull/13)

## [0.1.0] - 2026-11-27

### Added

- Record UI screenshots, logic checks, and verdicts locally with the `alibai` CLI and its versioned JSON evidence format. [#1](https://github.com/kut7728/alibi-for-ai/pull/1)
- Document the repository's commit, branch, pull request, and release conventions for contributors. [#2](https://github.com/kut7728/alibi-for-ai/pull/2)
- Review evidence in a local browser viewer with a timeline, before-and-after screenshot comparisons, and logic check details. [#3](https://github.com/kut7728/alibi-for-ai/pull/3)
- View case files in English, Korean, or Japanese and choose a language from the viewer or CLI. [#4](https://github.com/kut7728/alibi-for-ai/pull/4)
- Guide Claude Code, Codex, and Cursor through replaying the same checks on baseline and current revisions and recording the results. [#5](https://github.com/kut7728/alibi-for-ai/pull/5)
- Inspect staged, unstaged, and non-ignored untracked paths at run start and end. Dirty snapshots exclude `.alibai` and store paths plus a SHA-256 digest when available. Patch and file contents stay out of the record. [#7](https://github.com/kut7728/alibi-for-ai/pull/7)

### Fixed

- Accept loopback Host headers on the viewer port, show a browser tab icon, recognize regional language tags, and distinguish an omitted expectation from an explicit JSON `null` in exception evidence. [#6](https://github.com/kut7728/alibi-for-ai/pull/6)

[Unreleased]: https://github.com/kut7728/alibi-for-ai/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/kut7728/alibi-for-ai/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/kut7728/alibi-for-ai/releases/tag/v0.1.0

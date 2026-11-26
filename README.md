# Alibi for AI

> Your AI says it's fixed. Here's the evidence.

AI 코딩 에이전트가 수행한 테스트의 증거(UI 전후 스크린샷, 로직 입출력)를 로컬에 기록하는 도구입니다.

## 로컬 설치

Node.js 22 이상과 Git이 필요합니다. 이 저장소에서 패키지를 빌드하고 로컬 tarball을 설치합니다.

```sh
npm ci
pack_dir="$(mktemp -d)"
npm pack --pack-destination "$pack_dir"
npm install --global "$pack_dir/alibai-0.1.0.tgz"
```

## 기록하기

테스트 대상 Git 작업 트리에서 실행합니다. `before.png`와 `after.png`는 미리 캡처한 스크린샷 경로로 바꿉니다. 파일 경로는 명령을 실행한 디렉터리 기준입니다.

```sh
alibai run start --title "Login fix" --platform flutter --agent Codex
alibai step --action "Tap Sign in" --before before.png --after after.png --result pass
alibai check --target validateLogin --input '{"email":"a@example.com"}' \
  --before false --after true --expected true --result pass
alibai run end --verdict pass --summary "Login succeeds with a valid email."
alibai list --json
```

- `run start`는 제목만 필수입니다. 플랫폼은 `flutter`, `ios`, `android`, `web` 중 하나이며 기본값은 `web`입니다. 에이전트 이름은 선택 사항입니다.
- `step`에는 `--before` 또는 `--after` 스크린샷이 하나 이상 필요합니다. 순서는 1부터 기록하며 `--note`의 기본값은 빈 문자열입니다.
- `check`의 `--input`, `--before`, `--after`, 선택 항목인 `--expected`는 JSON 값입니다. 음수는 `--before=-1`처럼 전달하고, JSON 문자열은 `--after '"ok"'`처럼 JSON 따옴표를 포함합니다. `--error`는 오류 코드나 예외 이름 또는 메시지를 기록합니다.
- `step`과 `check`의 `--result`, `run end`의 `--verdict`에는 `pass`, `fail`, `info`를 사용합니다. 항목의 결과는 기본 `info`이며, 실행을 종료할 때는 판정을 지정합니다. `--summary`를 생략하면 판정을 담은 한 줄이 자동으로 기록됩니다.
- `step`, `check`, `run end`는 가장 최근에 시작한 열린 실행에 기록합니다. 특정 실행을 지정하려면 `--run <id>`를 사용합니다. 종료한 실행에는 항목을 추가할 수 없습니다.

기록 명령은 실행 ID와 `run.json`의 절대 경로를 출력합니다. `--json`을 쓰면 기록 명령은 `{"id":"…","path":"…"}`를, `list`는 최신순으로 정렬한 `{"runs":[…]}`를 stdout에 출력합니다. 목록의 열린 실행은 `verdict: null`로 표시됩니다. CLI 오류는 종료 코드 1과 함께 stderr에 `{"error":"…"}`로 출력됩니다. `fail` 결과나 판정도 기록에 성공하면 종료 코드는 0입니다.

## 포맷과 Git 기준

실행을 시작한 시점의 Git 브랜치와 커밋을 저장합니다. `--base <ref>`를 지정하면 해당 로컬 커밋을 기준으로 사용하며, 해석할 수 없는 ref는 오류로 처리합니다. 기본 기준은 현재 커밋과 다른 공통 조상을 `origin/HEAD` → `origin/main` → 로컬 `main` → `origin/master` → 로컬 `master` 순으로 찾아 사용합니다. 없으면 현재 커밋의 첫 번째 부모를 사용합니다. 기준이나 HEAD 커밋이 없으면 해당 SHA는 `null`이며, detached HEAD의 브랜치도 `null`입니다.

Git 작업 트리 루트의 `.alibai/runs/<run-id>/run.json`에 [버전 1 스키마](src/run.schema.json)를 따르는 기록을 저장합니다. 스크린샷은 실행 디렉터리의 `screenshots/`에 복사되며, JSON에는 실행 디렉터리 기준 상대 경로가 들어갑니다. 처음 실행을 시작할 때 `.alibai/.gitignore`를 만들어 증거를 Git에서 제외합니다.

동시에 같은 실행에 쓰는 명령은 잠금을 획득한 순서대로 처리됩니다. 저장은 임시 파일을 작성한 뒤 교체하는 방식입니다. 강제 종료 뒤 잠금 오류가 지속되면 해당 실행에 쓰는 프로세스가 끝났는지 확인한 후 오류 메시지의 빈 `.lock` 디렉터리를 제거할 수 있습니다.

테스트는 `npm test`로 실행합니다. 브라우저 뷰어와 `alibai open`은 다음 단계에서 추가될 예정입니다.

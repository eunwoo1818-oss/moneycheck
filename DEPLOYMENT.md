# Vercel 배포

기존 장애는 서버가 시작될 때 `/var/task/data` 디렉터리를 만들려다가 `ENOENT`로 종료되는 문제였다. 이 경로에 로컬 SQLite를 저장하는 방식은 Vercel 운영 저장소로 사용할 수 없다.

## 현재 배포 구조

- 정적 화면은 `public/`에서 제공한다.
- API는 `api/index.mjs`를 명시적 함수 진입점으로 사용하며 `/api/*` 요청을 처리한다.
- Vercel에서는 로컬 SQLite를 열거나 상시 HTTP 서버/타이머를 시작하지 않는다.
- 현재 운영 데이터는 무료 Spark 프로젝트 `moneycheck-2932b`의 기본 Firestore에 저장한다. 로컬 실행은 SQLite를 계속 사용할 수 있다.
- `FIREBASE_PROJECT_ID`를 설정하면 Firestore를 사용한다. 운영 서버는 Vercel OIDC와 Google Cloud Workload Identity Federation으로 인증한다. 서비스 계정은 이 프로젝트의 Firestore 데이터 권한만 갖는다.
- 브라우저의 Firestore 직접 접근은 `firestore.rules`에서 차단한다. 모든 데이터 요청은 Vercel API에서 사용자별 권한을 확인한다.
- 빌드 시 연결된 PostgreSQL에 `migrations/001_postgres.sql`을 트랜잭션으로 적용한다. 기존 데이터를 삭제하거나 샘플 금융 데이터를 생성하지 않는다.
- 데이터베이스가 없으면 500으로 프로세스가 종료되는 대신, 화면과 API에 저장소 미연결 상태를 알린다. 저장소 연결 전에는 앱을 사용할 수 없다.
- Node.js 24.x를 사용한다.

## Firebase 운영 연결

Firebase 프로젝트에 기본 Standard 데이터베이스를 만들고 `firebase.json`의 보안 규칙을 배포한다. 운영 환경에는 `FIREBASE_PROJECT_ID`, `GCP_PROJECT_NUMBER`, `GCP_SERVICE_ACCOUNT_EMAIL`, `GCP_WORKLOAD_IDENTITY_POOL_ID`, `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID`가 필요하다. Vercel 팀의 `moneycheck` 운영 배포만 Google Cloud의 서비스 계정을 사용할 수 있도록 제한한다. 계정 초기 설정, 예약 실행 및 이메일 변수는 아래와 동일하다.

## PostgreSQL을 사용할 경우

1. Vercel의 `moneycheck` 프로젝트에서 Storage를 열고 Neon PostgreSQL을 생성/연결한다. 무료 플랜을 사용하려면 결제 조건과 한도를 직접 확인한다. 제공자 계정/약관 동의는 소유자가 진행한다.
2. 연결 대상에 `moneycheck`의 Production을 포함한다. `DATABASE_URL` 또는 `POSTGRES_URL`이 해당 프로젝트의 Production 환경 변수에 제공되어야 한다.
3. `APP_URL=https://moneycheck-ivory.vercel.app`, `ADMIN_EMAIL`(소유자가 사용할 이메일), `CRON_SECRET`(고엔트로피 임의 값)을 Production에 설정한다. 비밀 값은 저장소에 넣지 않는다.
4. `main`의 최신 커밋으로 재배포한다. 데이터베이스 설정을 추가한 뒤에는 재배포가 필요하다.
5. `/api/status`가 200을 반환하는지 확인한다. 첫 계정은 `ADMIN_EMAIL`과 `ADMIN_SETUP_CODE`로 만들 수 있으며 이름은 JE.KIM이다. 설정 코드는 운영 환경의 민감한 환경 변수로 관리하고 관리자 본인에게만 전달한다.

Neon 이외의 PostgreSQL도 `pg` 드라이버와 호환되는 연결 문자열을 제공하면 사용할 수 있다. 연결 인증서 검증은 드라이버 기본 설정을 유지하며, 검증을 끄는 옵션을 사용하지 않는다.

## 구독 자동 기록

`vercel.json`의 예약 요청은 UTC 15:10, 한국시간 다음 날 00:10을 기준으로 하루 한 번 `/api/cron`을 호출한다. Hobby 플랜에서는 실행 시각이 지연될 수 있다. `CRON_SECRET`과 일치하는 Bearer 인증 없이 호출하면 거부한다. 앱에 접속할 때도 미기록 청구분을 보충한다.

## 이메일

비밀번호 재설정 메일은 별도로 `RESEND_API_KEY`, `MAIL_FROM`을 설정해야 발송된다. 미설정 상태를 실제 성공으로 표시하지 않는다.

## 검증

`node --test tests/*.test.mjs`로 로컬 API와 구독 규칙을 검사하고, PGlite의 실제 PostgreSQL 엔진으로 스키마·쿼리·롤백·일회용 토큰을 검사한다. 이 테스트는 운영 서비스에 접속하거나 운영 금융 데이터를 사용하지 않는다. 실제 클라우드 연결과 배포 상태는 배포 후 별도로 확인해야 한다.

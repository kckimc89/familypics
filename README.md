# 우리 가족 사진관 — MASTER V1.1 (클라우드 연결 준비판)

이 프로그램은 **명소대백과와 완전히 별개**입니다. 첫 화면은 **아이의 사진 / 가족의 사진** 두 공간으로 시작하고, 사진 한 장을 두 공간에 함께 표시할 수 있습니다. 사진 원본은 중복 생성하지 않습니다.

## 중요: 설치 전 확인

**현재 파일은 배포 가능한 소스 패키지이나, 사용자 계정의 서버에 실제 배포·연결되거나 실기기 검증된 버전이 아닙니다.** Supabase·Cloudflare 계정을 준비하고 아래 설정을 완료해야 실제 사진을 올릴 수 있습니다. 처음에는 중요하지 않은 테스트 사진만 사용하세요.

## 설치 순서

1. GitHub에 명소대백과와 다른 새 저장소 `family-photo-gallery`를 만듭니다. 웹앱 소스만 올리며 사진과 비밀번호는 절대 GitHub에 올리지 않습니다.
2. Supabase에서 사진관용 신규 프로젝트를 만들고 SQL Editor에서 **`schema.sql` → `migration_v1_1.sql` 순서**로 실행합니다. 기존 V1 DB라면 두 번째 파일만 실행합니다. 기존 `schema.sql`은 Supabase 비공개 Storage bucket도 만드지만, R2를 사용하는 최종 구성에서는 이 버킷을 실제 사진 저장소로 사용하지 않습니다.
3. Supabase Auth 이메일 로그인을 구성합니다. Auth redirect URL에 GitHub Pages URL을 추가합니다. 최초 관리자 계정은 사진관을 생성하고 가족은 1회용 초대코드로 참여합니다.
4. Cloudflare R2에서 **비공개 버킷 `family-photo-originals`**를 만듭니다. 공개 URL 및 R2 공용 버킷 기능은 사용하지 마세요.
5. Cloudflare Workers 프로젝트를 생성하고 `worker/worker.js`를 배포합니다. R2 binding 이름을 `PHOTOS`로 연결합니다. Workers의 **서버 환경 변수**로 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `ALLOWED_ORIGIN` (예: `https://YOURNAME.github.io`)을 설정합니다. 비밀키를 GitHub에 올리지 않습니다.
6. `config.js`에 Supabase URL·publishable key와 Workers HTTPS URL을 입력한 뒤 GitHub Pages를 배포합니다. 이 키는 공개용입니다. R2 자격증명이나 Supabase service_role은 절대 웹앱에 입력하지 않습니다.
7. 노트북·아이패드에서 로그인해 테스트 사진 1~2장 업로드 → 양쪽 사진관 표시 → 원본 내려받기 → 관리자의 휴지통/복구/백업을 먼저 검사하세요.

## 저장 방식

- R2 원본: 원래 HEIC/JPEG/PNG 파일을 변경 없이 보관합니다.
- R2 감상용: WebP 긴 쪽 2560px·Q85 (고화질 선택 시 3200px·Q90)
- R2 썸네일: WebP 480px
- Supabase: 로그인, 가족, 앨범, 설명, 사진 정보와 공간 분류
- Workers: 사용자의 Supabase 인증 토큰과 가족 소속을 확인하고, 사진마다 DB에 등록된 경로만 읽도록 검사
- 백업: JSON 메타데이터와 원본 ZIP을 각각 다운로드 가능. **ZIP은 브라우저에서 전체 파일을 메모리에 모으므로 소량 테스트용입니다.** 수만 장 안전한 분할 백업 및 원본으로 전체 복원은 아직 구현되지 않았습니다. 중요한 사진의 유일한 보관처로 사용하면 안 됩니다.

## 남은 작업과 검증 필요

- 실제 Supabase/R2/Workers/GitHub 접속 검증, 여러 가족 계정 교차 접근 차단 시험, 아이패드 Safari 실기기 시험.
- R2 PUT 후 DB 저장 실패 시 잔여 파일 정리, 업로드 재시도, 대용량 업로드와 안정적인 분할 백업.
- 대규모 목록 현재 1,000개 제한; 페이징 및 가상 스크롤.
- 중복 사진 해시 검사, 원본 전체 복원, 주기적 자동 백업, 90일 휴지통 정리, 저장 공간 계측.
- JPEG/PNG 등 브라우저가 디코딩할 수 있는 사진으로 먼저 시험하세요. HEIC는 기기/브라우저에 따라 감상용 변환에 실패할 수 있습니다.
- Workers Free의 요청/CPU/업로드 한도 및 Supabase Free의 용량/일시정지 규칙은 실제 운영 전 확인해야 합니다.

## 외장하드

외장하드 구매를 기다릴 필요는 없습니다. 보유 중인 SanDisk 64GB에 시험 사진과 정보 JSON을 백업해 볼 수 있습니다. 단, 64GB를 넘는 자료는 전체 백업을 할 수 없으며 **클라우드 원본과 별도의 검증된 백업**이 정식 운영의 필수 조건입니다.

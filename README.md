# SNS Spot Map

SNS, 네이버 블로그, 네이버 카페 링크를 장소와 묶어서 지도에 표시하는 MVP입니다.

## 실행

```bash
npm run dev
```

브라우저에서 엽니다.

```text
http://127.0.0.1:5173
```

## 앱처럼 설치

현재 프로젝트는 PWA로 구성되어 있습니다.

- Android Chrome: HTTPS로 배포한 주소를 열고 브라우저의 설치 또는 홈 화면 추가를 사용합니다.
- iPhone Safari: 공유 버튼을 누른 뒤 홈 화면에 추가를 사용합니다.
- 설치 후 Android Chrome 계열에서는 공유 대상 앱으로 등록될 수 있습니다.

로컬 `127.0.0.1`은 같은 컴퓨터 테스트용입니다. 휴대폰에서 쓰려면 Vercel, Netlify, Cloudflare Pages 같은 HTTPS 배포가 필요합니다.

## Vercel 배포

이 프로젝트는 Vercel 배포 준비가 되어 있습니다.

- 정적 앱: `index.html`, `app.js`, `styles.css`
- 서버리스 API: `api/link-preview.js`
- PWA 설정: `manifest.webmanifest`, `sw.js`

배포 후 해야 할 일:

1. 배포된 HTTPS 주소를 확인합니다.
2. Kakao Developers 앱 설정에서 Web 플랫폼 도메인에 배포 주소를 추가합니다.
3. 휴대폰에서 배포 주소를 엽니다.
4. 홈 화면에 추가 또는 설치합니다.

배포 주소 예:

```text
https://sns-spot-map.vercel.app
```

카카오 도메인 등록 예:

```text
https://sns-spot-map.vercel.app
```

## 카카오맵 연결

`config.js`에 카카오 JavaScript 키를 넣습니다.

```js
window.SNS_MAP_CONFIG = {
  kakaoJavaScriptKey: "YOUR_KAKAO_JAVASCRIPT_KEY"
};
```

카카오 개발자 콘솔에서 JavaScript 키를 발급하고, Web 플랫폼 도메인에 아래 주소를 등록해야 합니다.

```text
http://127.0.0.1:5173
```

키가 없으면 데모 지도로 동작합니다. 키가 있으면 실제 카카오맵, 마커, 주소 좌표 검색을 사용합니다.

## Supabase DB 연결

Supabase에서 프로젝트를 만든 뒤 SQL Editor에서 아래 테이블을 생성합니다.

```sql
create table public.spots (
  id uuid primary key,
  title text not null,
  type text not null default 'other',
  category text not null default 'other',
  address text not null,
  lat double precision not null,
  lng double precision not null,
  url text not null,
  summary text,
  created_at timestamptz not null default now()
);

alter table public.spots enable row level security;

create policy "Public read spots"
on public.spots for select
using (true);

create policy "Public insert spots"
on public.spots for insert
with check (true);

create policy "Public delete spots"
on public.spots for delete
using (true);
```

이미 `spots` 테이블을 만든 뒤 업종 구분을 추가하는 경우에는 아래 SQL만 추가로 실행합니다.

```sql
alter table public.spots
add column if not exists category text not null default 'other';
```

삭제 버튼을 쓰려면 아래 정책도 추가합니다.

```sql
create policy "Public delete spots"
on public.spots for delete
using (true);
```

그 다음 `config.js`에 프로젝트 URL과 anon public key를 넣습니다.

```js
window.SNS_MAP_CONFIG = {
  kakaoJavaScriptKey: "YOUR_KAKAO_JAVASCRIPT_KEY",
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_SUPABASE_ANON_PUBLIC_KEY",
  supabaseTable: "spots",
  linkPreviewEndpoint: "/api/link-preview"
};
```

설정값이 있으면 DB에 저장하고, 없거나 연결에 실패하면 브라우저 저장으로 돌아갑니다.

## 현재 되는 것

- 지도 위 위치 마커 표시
- 마커 클릭 시 하단 패널에 링크, 제목, 주소, 요약 표시
- Instagram, Naver Blog, Naver Cafe, 기타 필터
- 한식, 중식, 일식, 양식, 카페, 빵, 술집 업종 구분
- 새 링크와 위치 등록
- 등록 데이터는 브라우저 `localStorage`에 저장
- Supabase 설정 시 DB 저장
- 링크 분석으로 제목, 요약, 유형 자동 입력
- 요약/캡션에서 여러 장소 후보 추출 후 선택 저장
- 선택한 항목 삭제
- 카카오맵 키가 있을 때 주소를 좌표로 변환
- 카카오맵 키가 없고 좌표를 비워두면 서울 근처 임시 좌표로 저장

## 현실적인 제약

인스타그램, 네이버 카페, 일부 네이버 블로그 콘텐츠를 무단으로 자동 수집하는 방식은 API 제한, 로그인, 약관, 크롤링 차단 때문에 안정적인 제품으로 만들기 어렵습니다.

현실적인 제품 방향은 링크 등록형입니다.

1. 사용자가 원문 링크를 등록합니다.
2. 장소명 또는 주소를 입력합니다.
3. 지도 API로 좌표를 얻습니다.
4. 지도 마커를 누르면 하단에 원문 카드가 표시됩니다.

이후 서버를 붙이면 사용자 계정, 팀 공유, 장소별 여러 피드 묶기, 관리자 검수, 검색, 태그, DB 저장까지 확장할 수 있습니다.

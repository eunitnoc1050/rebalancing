# 연금계좌 리밸런싱 계산기

월별 투자금을 입력하면 현재 보유 포트폴리오를 목표 비중에 가깝게 맞추기 위해 ETF별 매수 수량을 계산하는 웹앱입니다.

## 로컬 실행

```bash
cd "/Users/mac/Documents/New project"
npm start
```

브라우저에서 `http://localhost:8080` 접속

주의: KRX Open API를 사용하므로 서버 환경변수 `KRX_AUTH_KEY`가 필요합니다.

## Cloud Run 배포

사전 준비:

- Google Cloud SDK 설치/로그인
- 결제 활성화된 GCP 프로젝트
- Cloud Run API, Artifact Registry API 활성화

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com
```

배포:

```bash
cd "/Users/mac/Documents/New project"
gcloud run deploy pension-rebalance \
  --source . \
  --region asia-northeast3 \
  --platform managed \
  --set-env-vars KRX_AUTH_KEY=YOUR_KRX_AUTH_KEY \
  --allow-unauthenticated
```

배포가 끝나면 출력되는 서비스 URL로 접속하면 됩니다.

## 동작 방식

- 프론트엔드: `index.html`
- 백엔드: `server.mjs`
  - `GET /api/prices?codes=379800,148020&basDd=20260227`
  - 서버가 KRX Open API(ETF 일별매매정보)를 프록시 호출
  - 업스트림 명세: `POST https://data-dbg.krx.co.kr/svc/apis/etp/etf_bydd_trd` with `{"basDd":"YYYYMMDD"}`
- 리밸런싱은 정수 주 단위로 계산되며 잔액은 현금으로 남습니다.

## 참고

- KRX 일별 API는 기준일(`YYYYMMDD`)의 종가 기준입니다.
- `KRX_API_URL` 기본값은 `https://data-dbg.krx.co.kr/svc/apis/etp/etf_bydd_trd` 입니다.
- 목표 비중 합계는 100%여야 계산됩니다.
- 기본 종목코드는 샘플입니다. 실제 계좌 종목코드로 수정하세요.

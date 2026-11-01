# Charlie 콘솔 (frontend)

HopCharlie 운영 콘솔입니다. 지금은 **시연용 시뮬레이션**입니다. 모든 데이터는 가상이고, 화면 상단 배너에 그 사실이 표시됩니다.

- 스택: Vite 8 + React 19 + TypeScript, 테스트는 Vitest + Testing Library
- 디자인: SoftBank 디자인 시스템 토큰 (`src/styles/tokens.css`)

```bash
npm install
npm run dev        # 개발 서버
npm test           # 시뮬레이션·화면 테스트
npm run build      # 타입 검사 + 프로덕션 빌드
```

## 구조
```
src/sim/data.ts     시연 데이터 (환경, 레포, 로그 타임라인)
src/sim/state.ts    시뮬레이션 상태 머신 (배포, 가져오기, 이전) — 실제 API로 바꿀 경계
src/sim/store.tsx   100ms 틱, React 구독
src/router.ts       해시 라우팅 (#overview, #apps, #app-<id>, #new, #onboard, #migrate, #migrate-shop, #envs)
src/pages/          화면
src/components/     공통 UI (Chip, Ind, LogBox, Table, PageHead)
```

실제 엔진과 연결할 때는 `src/sim/`를 migration-engine의 상태(`.hopcharlie/runs/*.json`)와 이벤트(JSON Lines / SSE)를 읽는 데이터 계층으로 바꿉니다. 그때는 상단 시연 배너를 지우고, `halted` / `rolled_back` / `failed`를 각각 따로 표시해야 합니다.

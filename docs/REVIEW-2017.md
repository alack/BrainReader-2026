# BrainReader 2017 회고 분석

2017-12-15 웹시스템설계 최종 발표 시점의 코드(`v2017-final` 태그)를 처음부터 끝까지 읽고 정리했다.
팀원 누가 썼는지는 따지지 않고 코드와 커밋 이력만 본다.

- 분석 대상: `server.js`, `server/routes/*.js`, `models/*`, `src/app/**` 전체 (spec 파일은 스캐폴드 기본값이라 제외)
- 근거 표기: **[확인]** 코드로 확인함 / **[추측]** 코드상 가능성은 있지만 실행해서 재현하지는 않음
- 이 브랜치(`review-2017`)는 기록용이다. 재작성은 `main`에서 한다.

---

## 1. 발표 때 무엇이 깨졌을까

실행해서 재현한 것은 아니다. 다만 아래 네 가지는 하나만 걸려도 시연이 멈춘다.

### 1-1. 게임 시작 전 채팅 한 줄에 서버 프로세스가 죽는다 [확인]

[server.js:142](../server.js)

```js
if(socket.room != '0' && exports.truewords[socket.room].word === data.message && ...)
```

`truewords[방]`은 출제자 클라이언트가 `/word/word`를 호출해야 생긴다. 방을 만들고 게임을 시작하기 전에 누가 채팅을 치면 `undefined.word`로 `TypeError`가 난다.
Socket.io 2의 이벤트 핸들러 안 예외는 아무도 잡지 않으므로 **Node 프로세스 전체가 종료**된다. 모든 방, 모든 접속자가 같이 끊긴다.

### 1-2. 다른 PC에서 접속하면 소켓이 연결되지 않는다 [확인] / 시연 환경에 따라 [추측]

[src/app/service/game-io.service.ts:11](../src/app/service/game-io.service.ts)

```ts
private url = 'http://localhost:80';
```

HTTP 요청은 상대 경로(`/user/login`)라 서버로 가지만, 소켓은 **접속한 사람 자기 PC의 80번 포트**로 붙는다. 서버 PC 한 대에서만 시연했다면 문제가 없고, 다른 노트북으로 접속했다면 로그인까지만 되고 대기실 유저 목록, 채팅, 게임이 전부 안 된다.

### 1-3. 정답 단어가 출제자 화면과 서버에서 다를 수 있다 [추측]

- 정답 단어는 **출제자 브라우저가** `/word/word`를 호출할 때 서버가 무작위로 뽑아 `truewords`에 덮어쓴다 ([server/routes/word.js](../server/routes/word.js)).
- `GameIoService`의 `getX()`는 구독할 때마다 `socket.on`을 새로 등록하고 해제하지 않는다. `GameRoomComponent`, `GameCanvasComponent`, `GameComponent`도 `ngOnInit`에서 만든 구독 일부를 `ngOnDestroy`에서 풀지 않는다.
- 방을 나갔다 들어오면 파괴된 컴포넌트의 구독이 살아 있어서 `nexthuman` 한 번에 `getWord()`가 두 번 이상 불릴 수 있다. 그러면 서버의 정답은 마지막에 처리된 요청의 단어고, 화면에 보이는 단어는 그와 다를 수 있다. **맞게 말했는데 정답 처리가 안 되는** 증상이 나온다.

### 1-4. 새로고침 한 번이면 그 계정으로 다시 로그인할 수 없다 [확인]

[server/routes/user.js:137-151](../server/routes/user.js) `/user/check`는 이미 접속 목록에 있는 유저를 **한 번 더** `server.users`에 넣는다. 새로고침할 때마다 이름이 하나씩 늘고, 로그아웃은 하나만 지운다.
중복 로그인 차단([user.js:85](../server/routes/user.js))이 이 목록을 보므로, 남은 사본 때문에 `already logged in`이 영구히 뜬다. 서버를 재시작해야 풀린다.

### 1-5. 커밋 이력이 보여 주는 것 [확인]

- 커밋 128개 중 **98개(77%)가 마지막 열이틀(12-04~12-15)** 에 몰렸고, 발표 당일 낮 12:40에도 기능 커밋(`userrequest in waiting room`)이 들어갔다.
- 테스트는 Angular CLI가 만든 기본 spec뿐이고, 한 판을 끝까지 돌려 보는 자동 검증은 없다.
- 결론: 기능을 마지막까지 붙이다가 **"두 브라우저로 한 판 끝까지"를 한 번도 고정된 절차로 확인하지 않은 채** 발표에 들어갔을 가능성이 크다. 아래 문제 대부분은 그 확인 한 번이면 드러났을 종류다.

---

## 2. 설계 문제

### 2-1. 상태의 원천이 여러 개다

같은 사실을 여러 곳이 따로 들고 있고, 서로 동기화하는 코드가 없다.

| 사실 | 들고 있는 곳 |
|---|---|
| 방에 누가 있나 | `room.users`(HTTP `POST /room/:id`로 추가), 소켓 room 멤버십(`joinroom`으로 추가) |
| 접속한 유저 | `server.users` 배열, express-session, 소켓의 `userName` |
| 정답 단어 | `truewords[방]`(서버), `problem_word`(출제자 화면) |
| 현재 화면 | `SessionService.currentPage` 문자열 (URL과 무관) |

방 입장이 HTTP 한 번, 소켓 한 번으로 나뉘어 있어서 둘 중 하나만 성공하면 유령 유저가 생긴다. 출제자는 `room.users`에서 뽑는데([server.js:306](../server.js)) 이 배열은 소켓이 끊겨도 정리되지 않는 경로가 있다.

**바른 방식:** 방과 게임 상태는 서버 한 곳(`Room` 객체)이 소유하고, 입장/퇴장/준비/정답 같은 모든 변경은 소켓 이벤트 하나로만 일어난다. 클라이언트는 서버가 보내는 스냅숏을 그리기만 한다.

### 2-2. 게임 흐름이 상태 기계가 아니라 플래그 조합이다

게임 진행이 `curcnt`(0이면 대기), `remainSec`, `painter`, 소켓별 `ready`, `truewords`의 조합으로 표현된다. "라운드 종료" 처리가 정답 경로([server.js:142-193](../server.js))와 시간 초과 경로(`holdPainter`, [server.js:296-331](../server.js))에 **두 번 복사**돼 있고, 서로 다르게 고쳐졌다.

- 정답 경로는 다음 라운드에서 `remainSec`를 리셋하지 않는다. 다음 출제자는 앞 사람이 남긴 시간만큼만 그린다.
- 정답 경로는 캔버스를 지우는 `clearcanvas`를 보내지 않고 `PICremove`로 따로 지운다.
- 정답 경로는 출제자를 정답자로, 시간 초과 경로는 무작위로 정한다. 무작위는 같은 사람이 연달아 걸릴 수 있다.

**바른 방식:** `lobby → choosing → drawing → roundEnd → (drawing | gameEnd)` 상태를 명시하고, 전이 함수 하나(`endRound(reason)`)만 라운드를 끝낸다. 상태 기계는 소켓과 무관한 순수 모듈로 두면 단위 테스트가 쉽다.

### 2-3. 정답을 클라이언트가 정한다

- 정답 단어 추첨을 **출제자 브라우저가** HTTP로 트리거한다. 서버는 받은 시점에 덮어쓸 뿐이다.
- `GET /word/word?roomId=X`, `GET /draw?roomId=X`는 인증이 없다. 누구나 호출해서 정답을 보거나 정답을 바꿀 수 있다 [확인].

**바른 방식:** 라운드가 시작될 때 서버가 단어를 뽑아 상태에 넣고, 출제자 소켓에만 보낸다. 다른 사람에게는 글자 수 같은 힌트만 보낸다.

### 2-4. 타이머 하나가 모든 방을 돈다

[server.js:76-93](../server.js) 1초 `setInterval` 하나가 모든 방을 순회하며 `remainSec--`를 한다. `setInterval`은 정확히 1초를 보장하지 않으므로 오차가 쌓이고, 방마다 시작 시점이 달라도 같은 박자에 묶인다. 매초 방마다 `console.log`를 찍는다.

**바른 방식:** 라운드 시작 시 `endsAt = Date.now() + 제한시간`을 저장하고 방마다 `setTimeout` 하나로 종료를 건다. 클라이언트는 `endsAt`으로 남은 시간을 직접 계산한다. 매초 브로드캐스트가 필요 없다.

### 2-5. 라우터가 서로를 순환 참조한다

`server.js`가 라우트를 `require`하고, 각 라우트가 다시 `require('../../server')`로 전역 배열을 가져간다. `exports.rooms = []`가 라우트 로드보다 뒤에 있어서, 요청 시점에 늦게 읽기 때문에 우연히 동작한다. 순서를 바꾸면 깨진다.

**바른 방식:** 상태는 별도 모듈(`RoomManager`)이 갖고, 서버 진입점에서 만들어 라우트와 소켓 핸들러에 인자로 넘긴다.

### 2-6. 화면 전환이 라우터가 아니다

`currentPage` 문자열과 `ngSwitch`로 화면을 바꾼다([start.component.html](../src/app/loginRoom/start/start.component.html)). URL이 바뀌지 않아 새로고침하면 항상 첫 화면이고, 뒤로 가기가 안 되며, 방 링크를 공유할 수 없다.

---

## 3. 서버 버그 목록

| # | 위치 | 문제 | 근거 |
|---|---|---|---|
| S1 | server.js:142 | 게임 전 채팅에 `truewords[방]`이 없어 프로세스 종료 | [확인] |
| S2 | server.js:151 | `socket.broadcast.emit('drawingauthremove')`가 방이 아니라 **서버 전체**로 나가 다른 방 출제자의 그리기 권한까지 뺏는다 | [확인] |
| S3 | server.js:121 | `if(roomidx = findIndex(...))`: 대입문을 조건에 썼고, 인덱스 0이면 거짓, 못 찾으면(-1) 참 | [확인] |
| S4 | server.js:236-238 | `userRemove`가 유저를 못 찾으면 `splice(-1, 1)`로 **마지막 유저를 지운다** | [확인] |
| S5 | server.js:118, 230 | `socket.leave(room, getUserList(room))`: 콜백 자리에 함수 **호출 결과**를 넘겨서, 나가기 전에 목록을 계산한다. 나간 사람이 목록에 남는다 | [확인] |
| S6 | server.js:266-272 | `find` 콜백 안에서 `splice`로 배열을 지운다. 순회 중 변경이라 빈 방이 여러 개면 일부가 남는다 | [확인] |
| S7 | server.js:278-291 | 혼자 들어가 준비를 누르면 1인 게임이 시작된다. 최소 인원 검사가 없다 | [확인] |
| S8 | server.js:165-171 | 정답 경로에서 `remainSec`를 리셋하지 않음 (2-2) | [확인] |
| S9 | server.js:146 | 정답을 맞히면 **무작위 유저**(`dangchumUser`)의 브라우저가 그림을 저장한다. 출제자가 아닌 사람이 지운 뒤의 캔버스를 저장할 수 있다 | [확인] |
| S10 | routes/room.js:33-41 | 방 입장 HTTP가 비밀번호를 검사하지 않는다. 비밀번호 검사는 클라이언트에서만 한다 | [확인] |
| S11 | routes/room.js:9-11 | `GET /room`이 **방 비밀번호를 포함한** 전체 방 객체를 모든 사람에게 준다 | [확인] |
| S12 | routes/room.js:44-58 | `PUT /room`이 응답을 보내지 않는다. 방장 확인 없이 누구나 아무 방이나 수정하고, `curcnt`까지 덮어쓸 수 있다 | [확인] |
| S13 | routes/user.js:137-151 | `/user/check`가 접속 목록에 이름을 중복으로 넣는다 (1-4) | [확인] |
| S14 | routes/user.js:117 | `res.redirect({result: true})`: redirect에 객체를 넘긴다 | [확인] |
| S15 | routes/user.js:77 | 콜백 안 `throw err`는 Express가 못 잡아 프로세스가 죽는다 | [확인] |
| S16 | routes/word.js:32-41 | 중복 검사가 `find`의 `err`만 본다. 결과가 있어도 에러가 아니므로 중복 단어가 그대로 저장된다 | [확인] |
| S17 | routes/word.js:10-23, draw.js:31-45 | DB가 비어 있으면 `documents`가 `null`이라 `.word`에서 예외 | [확인] |
| S18 | routes/draw.js:14-17 | `Date` 필드에 `toLocaleString()` 문자열, `Buffer` 필드에 base64 data URL 문자열을 넣는다 | [확인] |
| S19 | routes/draw.js, game-canvas.component.ts:135-138 | 서버는 `{result, obj}`를 주는데 클라이언트는 `data['image']`를 읽는다. **컴퓨터 모드는 그림이 표시되지 않는다** | [확인] |
| S20 | 전체 | 소켓 이벤트 페이로드 검증이 전혀 없다. `gamecnt`, `timeOut`, `maxUser`도 클라이언트 값을 그대로 쓴다 | [확인] |

## 4. 클라이언트 버그와 습관

| # | 위치 | 문제 |
|---|---|---|
| C1 | game-io.service.ts 전체 | `new Observable(o => socket.on(...))`의 teardown이 비어 있어 리스너가 해제되지 않는다. 구독할 때마다 소켓 리스너가 쌓인다 |
| C2 | game-room.component.ts:20-56, game-canvas.component.ts:38-51 | `ngOnInit`의 구독을 저장하지 않거나 `ngOnDestroy`에서 풀지 않는다. 파괴된 컴포넌트가 계속 이벤트를 받는다 |
| C3 | game-canvas.component.ts:54-64 | 정리 코드가 `mode`에 따라 갈라져 있어 `start`, `drawon`, `drawoff`, `end`, `color`는 어느 경로에서도 풀리지 않는다 |
| C4 | game-room.component.ts:25-44 | 유저 목록이 올 때마다 유저 수만큼 `/user/:id/findUser`를 호출하고, 응답 순서대로 배열에 넣는다. 순서가 매번 바뀌고 이전 응답이 늦게 오면 덮어쓴다 |
| C5 | game-canvas.component.ts:32 | `@ViewChild('cv')`로 받은 참조를 `document.getElementById`로 다시 덮어쓴다 |
| C6 | game-canvas.component.ts:144-145 | 캔버스를 지우려고 `width`를 563으로 바꿨다 562로 되돌린다. `clearRect`로 충분하다 |
| C7 | game-canvas.component.ts:96-101 | `mousemove`마다 소켓 메시지 하나. 스로틀이나 묶음 전송이 없다. 늦게 들어온 사람은 그려진 그림을 못 본다 |
| C8 | game-canvas.component.ts:124-129 | 흰색을 고르면 지우개가 아니라 **전체 지우기**가 된다. 색이 방 전체 공유 상태라 출제자가 아닌 사람도 바꿀 수 있다 (서버도 검사 안 함) |
| C9 | login.component.ts:38, register.component.ts:24 | 템플릿에서 부르는 메서드가 `private`이다. AOT 빌드(`ng build --prod`)에서 컴파일 에러가 난다. 그래서 개발 빌드로만 배포했을 것이다 |
| C10 | update-room.component.ts:13 | `styleUrls: ['/update-room.component.css']` 절대 경로라 스타일이 적용되지 않는다 |
| C11 | wait-userInfo.component.ts:17-23, wait-userList.component.ts:19 | 실제 데이터가 오기 전 화면에 `hibria`, `test` 같은 더미 값을 그린다 |
| C12 | user-Image.component.ts:29-36 | `readAsBinaryString` + `btoa`로 직접 인코딩하고 MIME을 `image/jpeg`로 고정한다. PNG도 jpeg로 저장된다. 용량 제한이 없어 서버 본문 제한을 50MB로 올렸다 |
| C13 | session.service.ts:45-66 | `attempt`, `correct`, `points`는 초기값이 없어 `+= 1`이면 `NaN`이 되고, 아무도 호출하지 않는다 |
| C14 | 여러 곳 | 사용자 피드백을 `alert()`로 한다 (`'nono'`, `'사람 꽉찼어. 다른방 찾아봐!'`) |
| C15 | 전체 | `any` 남용. `data['result']`처럼 문자열 키로 응답을 읽어 오타를 컴파일러가 못 잡는다. S19가 그 결과다 |
| C16 | 전체 | 이벤트마다 `console.log`. 운영 빌드에서도 그대로 남는다 |
| C17 | wait-roomList.component.ts | 방 목록이 HTTP 한 번이다. 새로고침 버튼을 눌러야 갱신된다 |
| C18 | main.ts:6-8 | `import 'hammerjs'` 중복 |

## 5. 보안

| # | 문제 |
|---|---|
| X1 | `GET /user`가 **모든 유저의 bcrypt 해시를 포함한** 문서를 인증 없이 반환한다. `/user/rank`, `/user/:id/findUser`, `/user/me`도 `password` 필드를 뺀 적이 없다 |
| X2 | `GET /user/admin`이 `admin` / `1234` 계정을 만든다. 누구나 호출 가능 |
| X3 | `PUT /user/:id`가 세션 확인 없이 아무 유저의 프로필 이미지를 바꾼다 |
| X4 | 세션 시크릿이 소스에 하드코딩(`'WEBSYSTEMDESIGN'`), `MemoryStore` 사용(재시작하면 모두 로그아웃, 메모리 누수 경고) |
| X5 | 소켓 연결에 인증이 없다. `joinroom`의 `userName`을 클라이언트가 보내는 대로 믿는다. **아무 이름으로나** 채팅하고 정답 포인트를 받을 수 있다 |
| X6 | 정답과 방 비밀번호가 클라이언트로 그대로 나간다 (S11, 2-3) |
| X7 | 비밀번호 정책, 아이디 형식 검사, 로그인 시도 제한이 없다 |
| X8 | `bcrypt`와 `bcrypt-nodejs`를 둘 다 설치. 후자는 관리 중단된 패키지다 |

## 6. 협업과 git 습관

이력에서 보이는 것만 적는다.

- **master에 직접 커밋하고 `git pull`로 병합 커밋을 만든다.** 병합 커밋 35개 중 PR 병합은 13개뿐이고, 나머지 22개 중 16개가 `Merge remote-tracking branch 'origin/master'` 같은 pull 병합이다. 이력이 꼬이고 무엇이 언제 들어갔는지 추적하기 어렵다.
- **커밋 하나에 여러 일을 섞는다.** 예: `todo room rejecting......(component part) room break complete. create function leaveJoin userCount removed canvas size fix and center create updateroom add category picture.` 되돌리기도 리뷰도 불가능한 단위다.
- **커밋 메시지 첫 줄에 설명을 다 이어 붙인다.** 266자짜리 첫 줄이 있다. 반대로 `debug typo`, `fix some error`처럼 무엇을 고쳤는지 없는 메시지도 많다.
- **"안 된다"는 상태로 커밋한다.** `Can not estabilish socket.io connect. ... cannot connect server.` 실패 상태 커밋 자체는 괜찮지만, 이후 그 문제가 해결됐다는 기록이 없다.
- **비슷한 브랜치가 사람 이름으로 남아 있다** (`j_man`, `jaehong`). 기능 단위가 아니라 사람 단위 브랜치다.
- README가 Angular CLI 기본 문구 그대로다. 실행에 MongoDB가 필요하다는 것, 단어 DB를 채워야 게임이 된다는 것(S17)이 적혀 있지 않다.
- 의존성: `@reactivex/rxjs`, `rxjs`, `rxjs-es` 세 개, `bcrypt`/`bcrypt-nodejs` 두 개, 쓰지 않는 `multer`.

---

## 7. 바른 구현 방식 제안

재작성(`main`)에서 따를 원칙과 뼈대다. 코드는 방향을 보여 주는 스케치이며 그대로 붙여 넣는 완성본이 아니다.

### 7-1. 서버가 상태를 소유한다

```ts
// packages/shared/src/events.ts — 서버와 클라이언트가 같은 타입을 쓴다
export interface ServerToClient {
  'room:state': (s: RoomSnapshot) => void;      // 방 상태는 항상 통째로 보낸다
  'round:word': (w: { word: string }) => void;  // 출제자에게만
  'draw:stroke': (s: Stroke) => void;
  'chat:message': (m: ChatMessage) => void;
}
export interface ClientToServer {
  'room:join': (p: { roomId: string; password?: string }, ack: (r: Result) => void) => void;
  'room:ready': (ready: boolean) => void;
  'draw:stroke': (s: Stroke) => void;
  'chat:send': (text: string) => void;
}
```

- 이름은 클라이언트가 보내지 않는다. 소켓 연결 시 세션 쿠키로 유저를 확정해 `socket.data.user`에 둔다 (X5).
- 모든 페이로드는 `zod` 스키마로 검사한다 (S20).
- 방 입장, 퇴장, 준비, 정답 판정은 전부 소켓 이벤트 하나로 처리하고 HTTP는 로그인/회원가입/랭킹/단어 관리에만 쓴다 (2-1).

### 7-2. 게임은 순수 상태 기계로

```ts
type Phase =
  | { kind: 'lobby' }
  | { kind: 'drawing'; round: number; drawerId: string; word: string; endsAt: number }
  | { kind: 'roundEnd'; round: number; word: string; winnerId?: string }
  | { kind: 'gameEnd'; scores: Record<string, number> };

function guess(room: Room, userId: string, text: string, now: number): Effect[] { ... }
function tick(room: Room, now: number): Effect[] { ... }   // 시간 초과 판정
function endRound(room: Room, reason: 'correct' | 'timeout', winnerId?: string): Effect[] { ... }
```

- 상태 전이는 소켓을 모르는 함수로 두고 `Effect`(누구에게 무엇을 보낼지) 목록만 돌려준다. 소켓 계층은 그 목록을 실행만 한다.
- 라운드 종료는 `endRound` 하나뿐이다 (2-2, S8).
- 출제자 순서는 입장 순서대로 돈다. 같은 사람이 연달아 걸리지 않는다.
- 시간은 `endsAt`과 방별 `setTimeout`으로 (2-4).
- 시작 조건: 2명 이상, 전원 준비 (S7).

### 7-3. 리소스는 만든 곳에서 정리한다

- 클라이언트 소켓 구독은 `useEffect`(React 기준) 안에서 `socket.on`하고 반환 함수에서 `socket.off`한다 (C1~C3).
- 서버는 `disconnect` 한 곳에서 방 퇴장을 처리하고, 방이 비면 그 방의 타이머까지 정리한다.

### 7-4. 그림은 획 단위로

- 포인터 이벤트(`pointerdown/move/up`)로 마우스와 터치를 같이 받는다.
- 점을 16ms 정도 묶어 `{ strokeId, color, width, points[] }`로 보낸다 (C7).
- 서버는 라운드 동안 획 목록을 보관해서 늦게 들어온 사람에게 다시 보낸다.
- 출제자만 그릴 수 있다는 검사는 서버에서 한다 (C8).

### 7-5. 데이터와 보안

- 응답 DTO를 따로 정의해 비밀번호 해시가 나갈 수 없게 한다 (X1).
- 세션 시크릿은 환경 변수, 세션 저장소는 DB (X4).
- 방 비밀번호는 해시로 저장하고 서버에서만 비교한다 (S10, S11).
- 프로필 이미지는 크기와 MIME을 서버에서 검사한다 (C12).

### 7-6. "한 판 끝까지"를 자동으로 확인한다

발표 실패의 직접적인 교훈이다.

- 상태 기계 단위 테스트: 정답, 시간 초과, 출제자 이탈, 마지막 라운드, 1인 남음.
- 브라우저 두 개를 띄워 로그인 → 방 생성 → 입장 → 준비 → 그리기 → 정답 → 게임 종료까지 가는 E2E 테스트 하나. 이게 통과하지 않으면 머지하지 않는다.

### 7-7. git

- `main`에 직접 커밋하지 않고 작업 브랜치에서 PR로 병합한다.
- 커밋 하나에 한 가지 변경. 첫 줄은 짧은 요약, 세부는 빈 줄 뒤에 항목으로.
- 규칙 전문은 `main`의 `AGENTS.md`에 있다.

# Firebase 계정별 도감 연결 절차

전국도감은 Google 계정마다 별도의 개인 수집 데이터를 사용하도록 구현되어 있습니다.

- `ownerEmail`로 지정한 기존 소유자 계정: 현재 사이트의 전국도감 보유 상태를 그대로 이어서 시작
- 그 외 새 Google 계정: 1,025종 전부 미보유 상태로 시작
- 각 사용자는 자신의 Firestore 문서만 읽고 수정 가능
- 로그인하지 않은 방문자: 현재 공개 도감 열람만 가능

## 1. Firebase 프로젝트와 웹 앱 만들기

1. Firebase Console에서 새 프로젝트를 만듭니다.
2. 프로젝트 안에서 웹 앱(`</>`)을 등록합니다.
3. 앱 이름은 `pokemon-dex-web`처럼 입력합니다.
4. 표시되는 `firebaseConfig` 객체를 복사합니다.

## 2. Google 로그인 켜기

1. Firebase Console → Authentication → Sign-in method로 이동합니다.
2. Google 제공업체를 사용 설정합니다.
3. 승인된 도메인에 `youngdeukseo.github.io`를 추가합니다.

## 3. Firestore 만들기

1. Firebase Console → Firestore Database에서 데이터베이스를 만듭니다.
2. 위치는 가까운 리전을 선택합니다.
3. Rules 탭에 저장소의 `firestore.rules` 전체 내용을 붙여 넣고 게시합니다.

보안 규칙은 다음 계정별 경로만 허용합니다.

```text
users/{로그인 UID}/collections/nationalDex
```

사용자는 자신의 UID 경로에만 접근할 수 있으므로 다른 사용자의 보유 카드 데이터를 읽거나 수정할 수 없습니다.

## 4. 사이트 설정값 넣기

`firebase-config.js`를 아래 원칙으로 수정합니다.

```javascript
window.POKEMON_DEX_FIREBASE = {
  enabled: true,
  config: {
    apiKey: "Firebase에서 받은 값",
    authDomain: "Firebase에서 받은 값",
    projectId: "Firebase에서 받은 값",
    storageBucket: "Firebase에서 받은 값",
    messagingSenderId: "Firebase에서 받은 값",
    appId: "Firebase에서 받은 값",
  },
  ownerEmail: "현재 도감 상태를 유지할 Google 이메일",
  userCollection: "collections",
  userDocument: "nationalDex",
};
```

`ownerEmail`은 반드시 기존 전국도감 994종 보유 상태를 이어서 사용할 Google 계정으로 지정합니다. 다른 계정은 최초 로그인 시 `baseMode: empty`로 생성되어 보유 0종으로 시작합니다.

서비스 계정 JSON이나 비공개 키는 필요하지 않으며 저장소에 올리면 안 됩니다.

## 5. 기존 브라우저 기록 이전

Google 로그인 후 전국도감의 `기존 기록 이전` 버튼을 누르면 해당 브라우저의 예전 localStorage 기록을 현재 로그인 계정의 Firestore 문서로 옮길 수 있습니다.

## 계정별 데이터 구조

```text
users
└─ {uid}
   └─ collections
      └─ nationalDex
         ├─ baseMode: "legacy" 또는 "empty"
         ├─ email
         ├─ displayName
         └─ overrides
```

- `legacy`: 공개 전국도감의 현재 보유 상태를 기본값으로 사용하며 변경된 카드만 `overrides`에 저장
- `empty`: 모든 카드를 미보유로 시작하며 사용자가 등록한 카드만 `overrides`에 저장

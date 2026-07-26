# Firebase 연결 절차

전국도감 사이트 코드는 Google 로그인과 Firestore 동기화를 사용할 준비가 되어 있습니다. 아래 설정을 한 번 완료하면 방문자는 열람만 가능하고, 지정한 Google 계정만 카드를 수정할 수 있습니다.

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
3. Rules 탭에 저장소의 `firestore.rules` 내용을 붙여 넣습니다.
4. `REPLACE_WITH_ADMIN_GOOGLE_EMAIL`을 실제 관리자 Google 이메일로 바꾼 뒤 게시합니다.

## 4. 사이트 설정값 넣기

`firebase-config.js`를 다음 원칙으로 수정합니다.

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
  adminEmails: ["관리자 Google 이메일"],
  documentPath: ["collections", "nationalDex"],
};
```

서비스 계정 JSON이나 비공개 키는 필요하지 않으며 저장소에 올리면 안 됩니다.

## 5. 기존 브라우저 기록 이전

관리자 Google 계정으로 로그인한 뒤 전국도감의 `기존 기록 이전` 버튼을 누르면 이전 localStorage 기록을 Firestore로 옮길 수 있습니다.

## 데이터 구조

Firestore 문서 경로는 다음 하나를 사용합니다.

```text
collections/nationalDex
```

이 문서의 `overrides` 맵 안에 전국도감 번호별 실제 보유 카드 정보가 저장됩니다. 공개 페이지에서는 한 문서만 읽기 때문에 카드마다 별도 문서를 읽는 구조보다 비용과 로딩 부담이 작습니다.

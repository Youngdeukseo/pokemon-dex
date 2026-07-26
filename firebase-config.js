"use strict";

// Firebase 콘솔에서 웹 앱을 등록한 뒤 아래 값을 채우세요.
// 이 설정 객체는 웹 앱에서 공개되는 식별 정보이며, 실제 쓰기 권한은
// Firestore Security Rules와 adminEmails로 제한합니다.
window.POKEMON_DEX_FIREBASE = {
  enabled: false,
  config: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: "",
  },
  adminEmails: [],
  documentPath: ["collections", "nationalDex"],
};

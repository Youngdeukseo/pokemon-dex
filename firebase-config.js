"use strict";

// Firebase 콘솔에서 웹 앱을 등록한 뒤 아래 값을 채우세요.
// ownerEmail 계정은 기존 전국도감 상태를 그대로 이어서 사용합니다.
// 그 외 새 Google 계정은 보유 0종 상태로 개인 도감이 생성됩니다.
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
  ownerEmail: "onesmemory@gmail.com",
  userCollection: "collections",
  userDocument: "nationalDex",
};

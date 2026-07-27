"use strict";

// ownerEmail 계정은 기존 전국도감 상태를 그대로 이어서 사용합니다.
// 그 외 새 Google 계정은 보유 0종 상태로 개인 도감이 생성됩니다.
window.POKEMON_DEX_FIREBASE = {
  enabled: true,
  config: {
    apiKey: "AIzaSyD1tyzDNvsMdispw1ZBc20MCvsztAq06Kc",
    authDomain: "pokemon-dex-40e92.firebaseapp.com",
    projectId: "pokemon-dex-40e92",
    storageBucket: "pokemon-dex-40e92.firebasestorage.app",
    messagingSenderId: "817332021463",
    appId: "1:817332021463:web:90f97ca404d5b82d7c2892",
  },
  ownerEmail: "onesmemory@gmail.com",
  userCollection: "collections",
  userDocument: "nationalDex",
};
"use strict";

(function () {
  const style = document.createElement("style");
  style.textContent = [
    "img {",
    "  -webkit-user-drag: none !important;",
    "  -webkit-touch-callout: none !important;",
    "  -webkit-user-select: none !important;",
    "  user-select: none !important;",
    "}"
  ].join("\n");
  document.head.appendChild(style);

  function isImageTarget(target) {
    return target instanceof Element && Boolean(target.closest("img"));
  }

  function protectImages(root) {
    if (root instanceof HTMLImageElement) {
      root.draggable = false;
    }
    if (root && typeof root.querySelectorAll === "function") {
      root.querySelectorAll("img").forEach(function (image) {
        image.draggable = false;
      });
    }
  }

  document.addEventListener(
    "contextmenu",
    function (event) {
      if (isImageTarget(event.target)) {
        event.preventDefault();
      }
    },
    true
  );

  document.addEventListener(
    "dragstart",
    function (event) {
      if (isImageTarget(event.target)) {
        event.preventDefault();
      }
    },
    true
  );

  document.addEventListener(
    "keydown",
    function (event) {
      const saveShortcut =
        (event.ctrlKey || event.metaKey) &&
        String(event.key).toLowerCase() === "s";
      if (saveShortcut) {
        event.preventDefault();
      }
    },
    true
  );

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      function () {
        protectImages(document);
      },
      { once: true }
    );
  } else {
    protectImages(document);
  }

  new MutationObserver(function (records) {
    records.forEach(function (record) {
      record.addedNodes.forEach(function (node) {
        if (node instanceof Element) {
          protectImages(node);
        }
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
})();

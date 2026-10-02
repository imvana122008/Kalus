(function (root) {
  'use strict';
  if (root.PKFA?.booted) return;
  root.PKFA = root.PKFA || {};
  Object.assign(root.PKFA, {
    booted: true,
    version: '5.0.0',
    name: 'PRIDE KEEPER Forum Assistant',
    events: new EventTarget(),
    asset(name) { return chrome.runtime.getURL(`assets/${name}`); }
  });
})(globalThis);

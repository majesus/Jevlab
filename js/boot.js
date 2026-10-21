/* Arranque: se carga el último para que app.js, entities.js y lab.js hayan registrado sus acciones y pestañas. */
(function () {
  'use strict';
  function start() { window.JEVApp.boot(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

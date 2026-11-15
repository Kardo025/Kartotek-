/* Kartotek: boot. The Stats and Algorithm screens are drawn by React (ui/src/tabs/Stats.jsx, Algorithm.jsx);
   the old engine renderers were removed on 2026-10-05 (they had been switched off since the React port). */
(function (global) {
  'use strict';
  var App = global.App;
  if (!global.KARTOTEK_DEFER_BOOT) App.boot();
})(window);

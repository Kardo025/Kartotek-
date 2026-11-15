// Study tab (id "etut"): the study library and the per-part self-regulated learning cycle.
// State stays on App (App.etutOpen, App.etutLibTab) and in App.EtutUI (transient form, focus mode, phase timer).
import React, { useReducer } from "react";
import Library from "./study/Library.jsx";
import Runner from "./study/Runner.jsx";
import Cycle from "./study/Cycle.jsx";
import "./study.css";

export default function Study() {
  const [, redraw] = useReducer((x) => x + 1, 0);
  const App = window.App, S = App.S, U = App.EtutUI;
  const et = App.etutOpen && S.etuts && S.etuts[App.etutOpen];
  if (!et || et.removed || !et.package) {
    App.etutOpen = null;
    if (U.focusOn()) U.setFocus(false);
    return <Library />;
  }
  // Study v2 packages (schema_version 2, workflow "cycle-v2") run the new cycle; every other package keeps the legacy runner
  if (window.KCycle && window.KCycle.isV2(et.package)) return <Cycle key={et.etut_id} et={et} redraw={redraw} />;
  return <Runner key={et.etut_id} et={et} redraw={redraw} />;
}

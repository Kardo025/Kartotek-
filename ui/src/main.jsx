import React from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import "./index.css";
import Shell from "./Shell.jsx";
import { REACT_TABS } from "./tabs/index.js";

// The legacy engine (window.App) owns state and the non-review tabs; React owns the shell and Review.
function mount() {
  const App = window.App;
  const el = document.getElementById("root");
  if (!App || !el) return;
  document.body.classList.add("k-app");
  App.views.study = function () {}; // Review is drawn by React
  // TU Delft AE Prep › Application (React only): the engine hides/shows tabs listed in EXAM_TABS
  if (App.EXAM_TABS && App.EXAM_TABS.indexOf("tud-apply") < 0) App.EXAM_TABS.push("tud-apply");
  Object.keys(REACT_TABS).forEach((t) => { if (REACT_TABS[t]) App.views[t] = function () {}; });
  (App.EXAM_TABS || []).forEach((t) => { App.views[t] = function () {}; }); // exam sections: overview, Review, Study, Cards
  createRoot(el).render(
    <MotionConfig reducedMotion="user">
      <Shell />
    </MotionConfig>
  );
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
else mount();

// Next to every AI button (task E1, ARCHITECTURE.md section 5.6): when no model is set up, a small control says so and opens
// Settings › Models. The button itself keeps working as before (Claude Code link, Copy prompt).
import React from "react";
import { Info } from "@phosphor-icons/react";
import { modelsAvailable, useModelStatus, openModelSettings } from "./ModelsPanel.jsx";

export default function ModelHint({ what }) {
  const desktop = modelsAvailable();
  const status = useModelStatus();
  if (desktop && (!status || status.configured)) return null; // set up (or still reading): nothing to explain
  const task = what || "this";
  const title = desktop
    ? "No model is set up. Kartotek can do " + task + " itself with an API key, your Claude Code or Codex subscription, or a local model: Settings, Models. Until then this button opens Claude Code, and the copy button copies the prompt."
    : "Models work in the desktop app. In this page, this button opens Claude Code and the copy button copies the prompt.";
  return (
    <button type="button" className="k-btn sm md-hint" title={title} aria-label={title}
      onClick={() => (desktop ? openModelSettings() : window.App.toast("Models work in the desktop app. Here, the button opens Claude Code."))}>
      <Info size={14} aria-hidden="true" />{desktop ? "No model set up" : "Desktop app only"}
    </button>
  );
}

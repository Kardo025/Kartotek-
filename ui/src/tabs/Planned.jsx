// Short pages of the new navigation (task D1): Career is announced, not built yet; the Mock exam picker is what
// "Mock exam" shows while the scope is All, because a mock exam always belongs to one exam.
import React from "react";
import { Briefcase, Timer, ArrowRight } from "@phosphor-icons/react";
import { PageHead, Panel, Btn } from "./kit.jsx";
import { EXAMS } from "../nav.js";

const App = () => window.App;

export function Career() {
  return (
    <div className="k-page">
      <PageHead title="Career" sub={<p className="k-sub">Planned.</p>} />
      <Panel title="Not built yet" id="career-planned">
        <p className="k-small pl-text"><Briefcase size={18} aria-hidden="true" className="pl-icon" />A place for career planning is on the list. It is not defined yet, and nothing is stored here.</p>
      </Panel>
    </div>
  );
}

// Mock exams of one exam (the Mock exam tab of an exam section lists the same ones)
function mockCount(exam) {
  const S = App().S;
  return Object.values(S.mocks || {}).filter((m) => m && !m.removed && m.package && m.package.exam === exam).length;
}

export function MockPicker() {
  return (
    <div className="k-page">
      <PageHead title="Mock exam" sub={<p className="k-sub">A mock exam belongs to one exam. Choose which one.</p>} />
      <Panel title="Choose an exam" id="mock-picker">
        <div className="pl-choices">
          {EXAMS.map((x) => {
            const n = mockCount(x.id);
            return (
              <Btn key={x.id} className="pl-choice" id={"mock-pick-" + x.id} onClick={() => App().switchTab(x.id + "-mock")}>
                <Timer size={18} aria-hidden="true" />
                <span className="pl-choice-t"><b>{x.label}</b><span className="k-small k-muted">{n === 0 ? "no mock exams yet" : n + (n === 1 ? " mock exam" : " mock exams")}</span></span>
                <ArrowRight size={16} aria-hidden="true" />
              </Btn>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

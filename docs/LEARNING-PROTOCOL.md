# Kartotek learning protocol (task F0, 2026-11-16)

Design only: no code changes. This document specifies how the thirteen ideas of `research\harness-integration\03-decisions.md` (section 3) enter Kartotek, how the packaged study cycle and the new live session live side by side, and what each idea changes in the data, the model calls, the scheduler and the evidence. Tasks F1–F8 build from it. The agent instructions it relies on are drafted in `prompts\` and `prompts\shared\` (section 8).

**Licence and LearnHarness (owner decision, 2026-11-16).** The first version of this document was written from `02-comparison.md` only. The owner then decided that Kartotek becomes **AGPL-3.0-only**, so LearnHarness 0.6.0 (Amos Blomqvist, AGPL-3.0-only) could be read in full, code and prompts included, and its good parts adapted. Section 12 lists what was taken, changed or left out and why; the drafts in `prompts\` now adapt LearnHarness's agent instructions and name their source in `adapted_from`. No LearnHarness program code is in Kartotek.

Words used here: **package** = a Study v2 `etut.json`; **topic** = one objective (`kazanim`) with its own cycle; **attempt** = one answer record in `progress.attempts` (append-only); **verified item** = a package item with `validation: "verified"`; **generated** = anything a model writes during a session (a question, an explanation, a problem, a hint, a proposition).

## 0. Fixed principles and what they mean in practice

| Principle (owner) | Rule in this protocol |
| --- | --- |
| The package stays the source of truth for packaged studies. | A session never writes into a package. Generated material lives in the learner data (`sessions`, `graph`), carries `origin: "generated"`, `validation: "unverified"` and its generator (`provider`, `model`, `prompt_id`, `prompt_version`), and is shown with a "Generated · not verified" chip. |
| Anything generated never updates the scheduler. | Only the existing DSR paths stay: the topic's free recall and first, unassisted attempts on verified package items (STUDY-RULES v2.8), lesson tests and Review. No generated question, check, problem, probe answer or graph node creates or rates a card. |
| Help is always recorded; a helped attempt is never independent evidence. | Every kind of help (package hints, steps, solution, lesson pane, model hints of any level, side questions, researcher briefs opened during an attempt, worked steps in teaching) is written to the attempt's `help` log before it is shown. `KCycle.assisted()` becomes "the help log is not empty" (old counters stay readable). |
| Probe: required in a live session, optional button in Priming. | Live session: Probe → Plan → Teach → Practice, the probe cannot be skipped (it can be short). Packaged: **Find my level** in Priming, never required, never a gate. |
| The old three confidence levels map onto the slider; old records keep their meaning. | Section 2.2: bands 0–39 / 40–79 / 80–100 = Guess / Unsure / Sure. An old record keeps its word and is never converted into a number. |
| The graph is seeded from packages without a model, grows from live sessions, and shows evidence state and memory strength. | Section 3.10: outcomes → propositions, relations → reasoning chains, computed at run time; accepted live-session propositions stored in the learner data. |
| Model error classification and interactive demos are out of scope. | No miss types are inferred by a model (the learner's own error log for legacy studies stays as it is); no demo builder. |

## 1. Two flows, chosen per topic

### 1.1 The packaged cycle (exists; additions in italics)

```
Priming  (topic preview; *optional "Find my level" probe*)
Learn & digest  (lesson + mind map + Feynman; *thinking-while-reading box*; *side questions*)
Applying  (verified items; *thinking field*; *0–100 confidence*; *model hint ladder in Practice mode*; *side questions*)
Evaluating  (*adaptive practice with generated problems*, or skip = deferred_by_user as today)
End  (final test with *thinking* and *confidence*, no help of any kind; report)
```

### 1.2 The live session (new)

```
Probe   required: make the goal concrete, then adaptive questions per prerequisite strand
Plan    the dependency map from what is held to the goal; the learner accepts or asks for changes
Teach   one reasoning step per turn: Predict → Teach → Check (repair before building)
Practice  adaptive generated problems on what was taught (+ bring your own problem)
```

A live session is **attached** to a package (grounded in the units of the chosen topics and their source pages; the teacher may use nothing else and cites pages) or **free** (a topic in the learner's words, optionally with files read locally as in E3).

### 1.3 Choosing per topic

- In a packaged study each topic has a **mode**: `cycle` (default) or `live`. The navigator shows a small switch on the topic ("Study this topic live").
- `live` replaces **Learn & digest** of that topic by an attached live session limited to the topic's units (and its prerequisites as found by the probe). The topic's Priming probe becomes required for that session. **Applying stays unchanged** (verified items are still the only path to DSR and to the seven states), Evaluating offers practice as in the cycle.
- The topic's cycle completes as today (Evaluating passed or deferred). Switching back to `cycle` keeps the session and its transcript; nothing is lost.
- A free live session belongs to no package; its taught propositions go to the graph after review (3.10).

## 2. Shared data model

### 2.1 Attempt (package items, final items; also the shape of session answers)

New optional fields on `progress.attempts[]` (Study v2):

| Field | Type | Meaning |
| --- | --- | --- |
| `thinking` | string ≤ 4000 | the learner's raw thinking typed (or dictated) with this answer |
| `thinking_at` | number | last edit time of the thinking text |
| `confidence_pct` | integer 0–100 or null | slider value; `null` = not given |
| `confidence` | `"guess"` \| `"unsure"` \| `"sure"` | kept: the band of `confidence_pct` (2.2), written together with it; on old records the only value |
| `help` | array | `{ kind, level?, at, ref? }`, kinds: `pkg_hint`, `pkg_step`, `solution`, `lesson_pane`, `model_hint`, `side_question`, `research_brief` |
| `model_hints` | integer | highest model hint level reached (0 = none) |

Existing fields stay: `hints`, `steps`, `solution_shown`, `pane_open` are still written (so old code paths and exports read the same), and `response.working` stays readable; new code writes `thinking` and mirrors it into `response.working` until every reader uses `thinking`.

`assisted(a)` becomes: `help.length > 0 || hints > 0 || steps > 0 || solution_shown || pane_open || model_hints > 0`.

### 2.2 Confidence: the slider and the three old levels

| Slider | Band (stored in `confidence`) | DSR mapping (unchanged rule) | Lesson-test MCQ score (unchanged) | Misconception flag when wrong |
| --- | --- | --- | --- | --- |
| 0–39 | `guess` | right → Hard, wrong → Again | 0.4 | no |
| 40–79 | `unsure` | right → Hard, wrong → Again | 0.7 | no |
| 80–100 | `sure` | right → **Good**, wrong → Again | 1.0 | **yes** |

- **What the number means** (from LearnHarness): the learner's stated probability that the answer they gave is correct. For a question with n options chance is 100/n; a confidence at or below chance on a chosen answer means the learner distrusts their own pick, which is honesty, not error. Wrong + high confidence is the strongest signal a model receives (`prompts\shared\confidence.md`).
- **"I don't know"** (from LearnHarness): a button next to the slider. It records `dont_know: true` and no confidence. It is a gap, never a wrong guess: the answer counts as not correct; for DSR it is eligible like a wrong answer without misconception (Again), because declining to guess is honest evidence of not knowing (decision D13); it is excluded from confidence calibration.
- The rule the scheduler sees is exactly today's: only `sure` turns a right answer into Good and a wrong one into a misconception. No old record changes meaning: an old `sure` stays `sure`.
- The slider has no default position; until it is moved there is no confidence, and an item without confidence is not DSR-eligible (as today). Keys `1`, `2`, `3` set 20 / 60 / 90 for speed; arrows move by 5.
- Old records are never given a number. Fine-grained statistics (reliability curve, Brier score) use only records with `confidence_pct`; banded statistics use both (2.3).
- Lesson tests (`KLesson`) and probes use the same slider; lesson results keep the band score so their review calendars behave as before.

### 2.3 Calibration statistics

- **Recall calibration** (DSR, `DSR.calibration`: predicted retrievability vs outcome on recall reviews) is unchanged; nothing in this protocol adds events to it.
- **Confidence calibration** (Stats): today a three-row table "Sure / Unsure / Guess vs accuracy" over legacy answers. New: (a) the same banded table over legacy answers, Study v2 attempts and lesson tests, old and new records together; (b) for records with `confidence_pct`, a reliability chart in 10-point bins with numerators and denominators, the mean confidence, the accuracy and the Brier score.
- **What counts:** only answers whose correctness is not decided by a model: verified package items (auto-graded or self-checked, not `uncertain`), lesson tests. Probe answers, live checks and generated practice are shown in a **separate "Generated questions" calibration** (their keys are unverified), so a wrong model key never makes the learner look miscalibrated.

### 2.4 Sessions (new top-level part of the learner data)

```jsonc
"sessions": {
  "ls-…": {
    "id": "ls-…", "kind": "live" | "practice", "title": "…", "created_at": 0, "updated_at": 0, "status": "probe" | "plan" | "teach" | "practice" | "paused" | "done",
    "attached": { "etut_id": "dsd-1", "topics": ["k2"], "units": ["U7", "U8"] } | null,
    "files": [{ "name": "…", "sha256": "…" }],               // free sessions with files: names and hashes only, never the content
    "goal": { "learner_words": "…", "concrete": "…" },
    "probe": { /* 3.5 */ }, "plan": { /* 3.6 */ }, "steps": [ /* 3.7 */ ], "problems": [ /* 3.8 */ ],
    "side": [ /* 3.11 */ ], "briefs": [ /* 3.12 */ ],
    "generator": [{ "provider": "…", "model": "…", "prompt_id": "teacher", "prompt_version": 1, "turns": 12 }],
    "usage": { "calls": 0, "input": 0, "output": 0, "cost_usd": 0 }
  }
}
```

Every generated object inside a session carries `origin: "generated"`, `validation: "unverified"`, `by` (provider · model) and `prompt` (id · version). Learner text (answers, thinking) is stored as typed. Sessions are exported with the backup (old-format backup gains a `sessions` key; an older Kartotek ignores unknown keys, and `KStore.normalize` treats a missing key as `{}`).

### 2.5 Graph additions (learner data)

```jsonc
"graph": {
  "nodes":  { "g-…": { "id": "g-…", "text": "…", "origin": { "session": "ls-…", "step": 4 } , "accepted_at": 0, "edited": false, "links": ["pkg:dsd-1:LO-3"] } },
  "chains": { "c-…": { "id": "c-…", "premises": ["g-…", "pkg:dsd-1:LO-2"], "conclusion": "g-…", "text": "…", "origin": { … }, "accepted_at": 0 } },
  "hidden": ["pkg:…"]                                      // seeded nodes the learner hid from the view (never deleted)
}
```

Seeded nodes are **not stored**: they are computed from the packages each time (3.10), with stable ids `pkg:<etut_id>:<outcome id>` and `pkg:<etut_id>:<relation id>`.

### 2.6 Progress (Study v2, `cv: 3`)

| Field | Meaning |
| --- | --- |
| `topic_mode` | `{ <kazanim_id>: "cycle" \| "live" }`, missing = `cycle` |
| `live` | `{ <kazanim_id>: "<session id>" }` the attached session of a live topic |
| `probe` | `{ session: "<id>", at, strands: { <strand id>: "held" \| "edge" \| "missing" } }` the latest Priming probe |
| `skipped` | `{ <kazanim_id>: { at, reason: "probe_held" } }` topics the learner chose to skip after a probe (3.6) |
| `reading_thinking` | `{ <kazanim_id>: [{ at, text }] }` thinking-while-reading versions |
| `evaluating[k]` | existing; new value `"practised"` with `evaluating_sessions[k] = "<session id>"` |

### 2.7 Package (no required change)

Two optional fields, both with fallbacks so every existing package keeps working and the audit does not require them:

- `outcomes[].proposition`: one sentence that states the outcome as a claim ("The high noise margin is VOH − VIH"); the graph node text. Fallback: the outcome's criteria joined.
- `relations[].premises` / `relations[].conclusion`: outcome ids for the graph chain. Fallback: derived (3.10).

### 2.8 Migration (lossless)

- Progress `cv: 2 → 3` in `KCycle.migrate`: add `topic_mode: {}`, `live: {}`, `skipped: {}`, `reading_thinking: {}` when missing; for each attempt, `thinking = response.working` when `thinking` is missing and `working` is not empty (the `working` field stays). Nothing is removed or rewritten; `confidence_pct` is not invented.
- State: `sessions: {}` and `graph: { nodes: {}, chains: {}, hidden: [] }` added by `KStore.normalize` when missing. The desktop store (C3) gets two new parts (`sessions\s<n>.g<N>.json` in chunks like cards, `graph.g<N>.json`); `countRecords` gains `sessions`, `sessionTurns`, `graphNodes`, `graphChains`, and the import report lists them (the acceptance check then also compares them).
- Tested on a copy of the real export (`KARTOTEK_BACKUP=… npm test`): every count identical, the review queue identical, old attempts render with their word confidence.

## 3. The thirteen ideas

Each idea: where it appears, data, model call (request → structured reply), no model, effects. "States" = the seven evidence states of the outcome report (`not_assessed`, `uncertain`, `needs_work`, `assisted`, `independent`, `retained`, `transfer`).

### 3.1 Thinking fields

- **Packaged:** an optional "Your thinking" box under every Applying and final-test item (above the answer controls, collapsible, remembered open/closed); a "Thinking while reading" box in Learn & digest per topic (saved as versions like Feynman); the existing "my assumptions" box in Priming stays and is labelled as thinking.
- **Live:** with every probe answer, prediction, check and practice problem (the main input of practice).
- **Data:** `attempt.thinking`, `progress.reading_thinking`, session turns `thinking`. Included in exports, never required.
- **Model:** sent as context to the hint giver, the practice coach, the teacher and the prober (fenced as learner text); also added to the Explain request (STUDY-RULES v2.9 already sends "the working").
- **No model:** stored and shown back in the attempt history and the report's process history; Explain via Claude Code receives it.
- **Effects:** none on DSR, states or calibration. Report: the process history shows "thinking written" per attempt (not its text, which opens on click).

### 3.2 Confidence 0–100

- **Both flows:** replaces Guess / Unsure / Sure everywhere confidence is asked (Applying, final test, lesson tests, probe, predictions and checks in teaching, practice).
- **Data, mapping, statistics:** 2.1–2.3.
- **Model:** the slider value is sent with probe answers, predictions and checks; the prober and teacher use high-confidence errors as signals (a confident wrong prediction = a step to repair before building).
- **No model:** works fully.
- **Effects:** DSR rule unchanged through the bands; states unchanged; calibration as 2.3; report unchanged (it shows no confidence today).

### 3.3 Editable prompts

- **Built in E1** (decision 14): `prompts\*.md` with front matter, overrides in the user data, Settings › Models › Prompts with editor, reset and "default changed" flag. F1's third item is therefore done.
- **This task adds** the eight agent drafts (section 8); each later F task turns its draft into a shipped prompt with a schema file (`prompts\schemas\`), bumps its `version` when the text changes, and lists its variables.
- **Shared fragments** (from LearnHarness's prompt composition): the voice, accuracy, thinking, confidence and side-conversation rules live once in `prompts\shared\*.md`, and an agent prompt lists the ones it uses in `includes:`. The prompt service composes the agent text with its fragments in that order; each fragment can be edited and reset on its own in Settings, Prompts, and an edit applies to every agent that includes it (D16). Until that is built (proposed with E2), the drafts are not used.
- **Effects:** none on evidence. Every generated object records `prompt_id`, `prompt_version` and, for an override, the hash (already in the usage log), so a learner can see which instruction text produced it.

### 3.4 Hint ladder

Rungs (adapted from LearnHarness's practice doctrine; the package's own hints, steps and solution stay as they are):

| Rung | Gives | Example (noise margin, "find NMH") |
| --- | --- | --- |
| R0 attention redirect | points at what to re-read or look at | "Re-read which voltages describe the high side." |
| R1 pattern re-description | names the kind of pattern, no idea named | "You are comparing a guarantee with a requirement." |
| R2 candidate class | narrows to a group of results | "One of the two noise-margin definitions applies." |
| R3 the idea, named | the retrieval is given away | "Use the high noise margin, NMH = VOH − VIH." |
| R4 the move outlined | running it is given away | "Subtract the receiver's VIH from the driver's VOH." |
| R5 the worked step | everything except the lesson | "NMH = 2.4 − 2.0 = 0.4 V." |

- **The rule:** from the thinking, find the first question in the solving loop the learner cannot answer (or answered wrongly) and answer exactly that, at the coarsest grain that unblocks; one rung per request. When the trace grinds at execution with the wrong idea, the first failure is earlier: give a **verification nudge** ("check the assumption behind your move"), never the correction.
- **Statement repair is free:** "I don't understand what is asked" is fixed fully and immediately; it is recorded as `{ kind: "statement_repair" }` and **does not count as help** (it is logistics, not the material). Kartotek checks that a repair reply contains no solution step (the reply's `reveals` must be empty).
- **The rung needed is a difficulty readout:** R0–R1 means the problem was about right, R3 and above means it was over the edge; practice uses it for the next problem (3.8).
- **Packaged:** Applying in Practice mode, "Ask for a hint"; each press gives the next rung. Check-without-help mode and the final test: no hints (unchanged).
- **Live:** in checks and practice problems.
- **Data:** `help: [{ kind: "model_hint", level: "R0"…"R5", at }]`, `model_hints` = highest rung (0–5, R0 = 0 counts as help).
- **Model request:** item (stem, options, the package key, solution and criteria; for generated problems their committed solution), learner response so far, thinking, rungs already given, the rung requested. **Reply:** `{ rung, stuck_at, hint, reveals }`. Kartotek refuses a reply whose rung is higher than requested and shows the package help instead.
- **No model:** the package's hints → steps → solution, as today.
- **Effects:** any model hint (R0 included) makes the attempt assisted: not DSR-eligible; at best `assisted` in the states (as package hints today); a statement repair alone does not. Calibration: assisted answers stay out of the fine chart (D7). Report: the process history lists the highest rung per attempt.

### 3.5 Probe

- **Live (required):** first makes the goal concrete (one or two questions: "what should you be able to do at the end?"), then asks adaptive multiple-choice questions one at a time, each chosen from the previous answer, its confidence and the thinking text, to find per prerequisite strand the hardest thing reliably right and the first thing wrong. Stops when every strand is located or after a question budget (default 15, decision D4).
- **Packaged (optional):** "Find my level" in Priming of the topic or of the part; the strands come from the topic's outcomes, its relations and the part's prerequisites (computed, no model). Questions are generated (never package items: using them would mark later attempts as "repeated" and cost DSR eligibility).
- **From LearnHarness** (`prompts\prober.md`): read the learner's knowledge graph first (strands held solidly need no re-probing); make the goal concrete with multiple-choice questions before measuring; **enter each strand near the top**, not at the basics; let strands inform each other; jump sharply after a confident right answer, step gently after a hesitant one, narrow down after a miss; dig into a misunderstanding's extent before moving on; every question must move an edge. The conclusion gives, per strand, the floor, the ceiling, the misunderstandings and what to build from. Kartotek adds the question budget and grades every probe answer in code against the committed key.
- **Data:** `session.probe = { strands: [{ id, label, outcome_ids?, unit_ids? }], questions: [{ id, strand, stem, options, key, why, answer, confidence_pct, thinking, at, generated… }], result: { <strand>: { status: "held" | "edge" | "missing", held_up_to, first_miss, notes } }, goal }`; packaged: `progress.probe` keeps the latest result.
- **Model request** (prober): goal, strands (with unit text when attached), answered questions so far with confidence and thinking. **Reply:** `{ next: { strand, stem, options[2–5], key, rationale, difficulty } | null, strand_status: { <strand>: "held" | "edge" | "missing" | "open" }, done, summary_md }`. The app checks the question (options unique, one key, no "all of the above") before showing it; the learner's answer is graded by the code against `key`.
- **No model:** live sessions are unavailable (the Study library says what to set up). Packaged: the button shows the topic's outcomes and criteria as a self-rating list ("I can already …" yes / not sure / no), stored the same way with `source: "self"`.
- **Effects:** never DSR; never states (it is a measurement before study, with unverified keys); calibration: "Generated questions" only; report: a column "Probe before studying: held / edge / missing" per outcome when a probe ran.

### 3.6 Personal plan map

- **Packaged:** computed, no model: nodes = topics (and their outcomes), edges = part prerequisites + relations mapped to outcomes (3.10) + topic order. The probe colours them (held / edge / missing). Topics marked held may be **skipped by the learner's choice** ("Skip this topic"), never removed: the topic stays in the navigator with "skipped after probe", its cycle counts as complete for opening End, and the final test still covers its criteria (decision D5).
- **Live:** the planner proposes the smallest dependency tree from what the probe found held to the goal; the learner accepts it or asks for changes (free text) before teaching starts; teaching moves the "you are here" marker; when a check reveals a missing prerequisite, the planner inserts it and the map is redrawn (old versions kept).
- **Data:** `session.plan = { versions: [{ at, nodes: [{ id, label, kind: "held" | "learn" | "goal", depends_on: [], units?: [] }], accepted_at, reason }], current: <index>, position: <node id> }`; packaged skips in `progress.skipped`.
- **Model request** (planner): goal, probe result, strands, attached units and relations (attached) or files' summary (free), the learner's change request. **Reply:** `{ nodes: [{ id, label, kind, depends_on, units, why }], order: [ids], notes_md }`; the app checks acyclicity and that attached nodes cite known units.
- **No model:** packaged map works; live unavailable.
- **Effects:** none on DSR, states, calibration. Report: skipped topics are marked "skipped after probe (held)"; their outcomes keep whatever states the final test gives.

### 3.7 Step-by-step teaching (live Teach)

One reasoning step per turn, following the plan:

1. **Predict:** a question about the step before it is taught; the learner answers with thinking and confidence (multiple choice or short text).
2. **Teach:** a short explanation that resolves the prediction (right: confirm and extend; wrong: name what the prediction missed) and builds only on held nodes; at most about 150 words and one figure description; attached sessions cite unit pages; anything the model is not sure of is marked `uncertain` (and offered to the researcher, 3.12).
3. **Check:** shown after the learner presses "I've read it": a question that needs the step applied (not recalled). A miss means **repair** (re-teach the step another way, then a new check) before the plan moves on.

- **From LearnHarness** (`prompts\teacher.md`):
  - *The end of a session* is reached when the goal **feels obviously true** to the learner; Kartotek asks it at the end as a self-report ("Does this now feel obviously true?" yes / not yet), stored with the session, never used as evidence (D14).
  - *Two principles:* unconditional truths first (facts that can be accepted at face value; universal statements and real definitions are the strongest), and "how could I have discovered this?" (every step motivated by the problem that demands it).
  - *Socratic or expository per step:* the learner attempts the discovery first where they can plausibly reason there; otherwise the teacher narrates the motivated path.
  - *Predictions arrive open, checks arrive closed:* the check is shown behind "Check your understanding" after the teaching text, so nothing interrupts reading; a check without teaching before it is a failed check.
  - *Question principles for checks:* answerable from the session, never parroting, prefer application, built so that each wrong option corresponds to a specific wrong model.
  - *The map moves:* the plan is a hypothesis; a check that reveals a missing foundation adds it, a held node is pruned, and a repair is never rushed to get back on plan. Every question carries its plan node and its type (predict or check), which is how the map shows the position.
  - *No narration of the method:* no "Node 3:" chapters, no "now I will establish X".
- **Data:** `session.steps[] = { node, predict: { q, options?, answer, thinking, confidence_pct, correct }, teach: { md, refs, uncertain: [] }, check: { q, options?, key, answer, thinking, confidence_pct, verdict: "right" | "partly" | "wrong", help: [] }, repairs: n, at }`.
- **Model request** (teacher): plan and position, the step's node, held nodes, attached units and source text (attached) or the learner's material, the last turns, the learner's prediction/answer with thinking and confidence. **Reply** (one of): `{ phase: "predict", question, options?, why }` · `{ phase: "teach", md, refs, uncertain, next: "check" }` · `{ phase: "check", question, options?, key?, rubric?, why }` · `{ phase: "verdict", verdict, feedback_md, repair: bool }`.
- **No model:** unavailable.
- **Effects:** never DSR; states: none directly (decision D1: shown as "session evidence", not as states); calibration: "Generated questions"; report (attached topic): a row "Live session: 8 steps, 6 checks right without help, 1 after repair".

### 3.8 Adaptive practice (Evaluating, live Practice, free practice)

- **Packaged:** fills **Evaluating** for the topic: generated problems on the topic's outcomes, one at a time; later problems mix in earlier topics of the same part; skipping stays possible (`deferred_by_user`). **Live:** the Practice phase after teaching. **Free practice:** from the Study library or from selected graph nodes.
- **Rules for the coach** (adapted from LearnHarness's practice doctrine, `prompts\practice-coach.md`):
  - *The theory:* practice exercises an idea while it is **inactive**, so only the situation can bring it to mind; a problem's yield is its number of **decision points**; retries land in a fresh setting; targets are **interleaved**, never blocked.
  - *Difficulty:* aim at about **85 % success per retrieval event** (per decision point, not per problem; D6), at the edge of the band because hints can rescue a stall.
  - *Three modes in order:* recall → discrimination → composition; a failure in a later mode sends the target back to the earlier one. Templates: reverse (conclusion given, grounds asked), discriminate, probe the premises.
  - *Selection:* the weakest target first, then the most-served (ideas feeding many chains: for packaged studies, outcomes that are premises of many relations), then the least recently active; the cheapest mode not yet shown; one notch up after a clean solve, hold after a helped solve, one notch down after a miss; two misses in a row on a target switches target.
  - *Arc:* open warm (one to three easy recall problems), interleaved main body, close by retesting every miss, hint-heavy and given-up problem in a fresh setting.
  - *Commit before posing:* the coach solves the problem, commits the model solution, tries to break it (a shortcut that skips the target makes it unsound), and only then shows it.
  - *Reading work:* the learner works in the thinking field; a claimed answer gets a verdict that localises the first break without the correction; a claimed answer is not a reason to move on; the problem ends when it is solved or the learner gives up; after it ends, the learner may ask about it, and the next problem comes only on "Next problem".
- **Data:** `session.problems[] = { id, targets, mode: "recall" | "discrimination" | "composition", template?, difficulty, setting, statement, model_solution, answer?, submissions: [{ thinking, claimed, verdict, at }], outcome: "solved" | "solved_with_hints" | "moved_on" | "given_up", highest_rung, retest, returned_of?, disputed?, generated… }`; packaged Evaluating stores the session id in `progress.evaluating_sessions[k]` and `evaluating[k] = "practised"`.
- **Model request** (practice coach): targets with criteria (attached: units and source text), earlier problems with modes, outcomes and rungs, the learner's turn. **Reply:** a new problem, a verdict on a claimed answer, a conclusion (outcome, highest rung, retest), or a reply in the pause.
- **Left out:** LearnHarness classifies every miss (cue, discrimination, execution, careless, structural). Model error classification is out of scope by the owner's decision, so the coach does not do it.
- **"Report a problem"** marks a generated problem `disputed` (as package items today).
- **No model:** Evaluating stays the deferred placeholder; free practice unavailable.
- **Effects:** never DSR; states: session evidence only (D1); calibration: "Generated questions"; report: "Generated practice: 5 problems, 4 solved without help (not verified)".

### 3.9 Bring your own problem

- **Where:** in any practice session ("My own problem"): paste text or pick a file (read locally, E3 extraction; a photo goes to the vision slot).
- **Flow:** the coach first solves it (and says when the problem is ambiguous or unsolvable from what is given), then runs the same thinking → hint → verdict flow.
- **Data:** a problem with `origin: "learner"`, the stem as given, the model's solution `validation: "unverified"`.
- **No model:** unavailable. **Effects:** as 3.8.

### 3.10 Knowledge graph

- **Seeding (no model, at run time):** for every Study v2 package: one **proposition** per outcome (`pkg:<etut>:<LO>`; text = `proposition` or the criteria; origin = package, topic, pages of its units) and one **chain** per relation (`pkg:<etut>:<R>`): conclusion = the outcome that lists the relation (first one), premises = the other outcomes that cover any of the relation's units; when there are no other outcomes the chain is shown as a labelled self-link on the conclusion. Ids stay stable across package versions as long as the package keeps its ids (STUDY-RULES v2.3 step 12 already requires that).
- **Growth (live):** after a session the graph extractor proposes propositions and chains from the transcript, each linked to the turn it came from and, when it matches, to existing nodes; the learner accepts, edits or rejects each one before anything is stored (`graph.nodes`, `graph.chains`). Accepted live nodes are generated content the learner approved; they stay labelled "from a live session".
- **From LearnHarness:**
  - every node has a short **name** (a glossary-style handle shown on the canvas), a precise **statement** (the identity of the node) and **aliases** (other phrasings that were linked to it);
  - a chain's premises **jointly entail** its conclusion (historical or narrative links are not chains); a chain with several premises is drawn through a small implication node, a single-premise chain as a direct arrow;
  - the graph holds **true ideas about the world only**, never statements about the learner; a misunderstanding enters as its correction;
  - **identity**: Kartotek finds up to five candidate records per new idea by text similarity (locally, no model), the extractor decides link or create, the learner confirms; a linked idea adds its wording as an alias;
  - **coverage**: each session turn is fingerprinted after extraction, so a session is never extracted twice and a later run handles only new turns;
  - **notes import** (D15): a notes file (or a package's `source.md`) can be run through the same extractor and review.
- **Kartotek's difference:** LearnHarness removed assessment from its graph; Kartotek keeps the graph records free of assessment too, but the view shows each node's evidence state and memory strength computed from the package evidence and the scheduler (never stored in the graph records).
- **View:** Study mode, pan and zoom, layout with foundations at the bottom (chain depth), filter by study or exam, search, click-through to the lesson block or session turn. **Each node shows its evidence state** (package nodes: the outcome's state from `KCycle.report`; live nodes: session evidence, D1) **and its memory strength** (package nodes: retrievability of the topic's card from DSR; live nodes: none, because they have no card).
- **Model request** (graph extractor): transcript (steps, teach texts, checks), existing nodes nearby (by text similarity, computed locally). **Reply:** `{ propositions: [{ text, turn, links: [existing ids], confidence: "clear" | "tentative" }], chains: [{ premises: [ids or new indexes], conclusion, text, turn }] }`.
- **No model:** the seeded graph and its view work fully; growth from sessions is unavailable.
- **Effects:** none on DSR (decision D2 keeps "make a card from a live node" out); states are only displayed; report unchanged.

### 3.11 Side questions

- **Where:** a side panel on Learn & digest, Applying (Practice mode), live and practice screens; not in check mode or the final test.
- **Context sent:** what is on screen: the lesson block (with refs), or the current item **without its key and solution while the attempt is not committed**, or the session turn; plus the question.
- **Reply:** `{ answer_md, uses: ["U7", "p. 9"], beyond_source: bool, uncertain: bool }`; "beyond source" answers carry a warning.
- **Data:** `session.side[]` or `progress.side[]` `{ at, context_ref, q, answer, by }`; an attempt open at that moment gets `help: [{ kind: "side_question" }]`.
- **From LearnHarness:** the helper never solves an open question (no eliminating options, no confirming an answer, no near-identical worked example) but may clarify wording, define terms and give a small nudge; the side exchanges are passed to the teacher or coach with its next request as append-only history, and "the helper explained it" is never taken as "the learner understood it" (`prompts\shared\side-conversations.md`).
- **No model:** the panel offers "Copy prompt" and the Claude Code link (as the AI buttons today).
- **Effects:** during an attempt = assisted (like the lesson pane): not DSR, at best `assisted`. Otherwise none.

### 3.12 Researcher

- **Where:** background job (the E3 job runner) called by the teacher, the practice coach and content writing when a fact is marked uncertain, and a manual "Check this" on explanations, teach texts and side answers.
- **Request:** the claim, its context, the source refs it should agree with. **Reply:** `{ verdict: "supported" | "contradicted" | "unclear", brief_md, sources: [{ title, url, quote ≤ 25 words }] }`; a brief without sources is not shown as a verdict.
- **Availability:** only with a provider that has web search (today: the Anthropic adapter's web search tool) or a search key (decision D8); otherwise the feature is hidden.
- **Data:** `session.briefs[]` / attached to the explanation; never written into a package. For a packaged study a "contradicted" brief offers "Report a problem" on the related block or item.
- **Effects:** none on DSR or states; opening a brief during an attempt = help (assisted).

### 3.13 Dictation

- **Where:** a microphone button on every thinking field and on the Feynman box.
- **Options** (F8 compares them again before building): (a) Windows voice typing (`Win + H`) already works in Kartotek's text fields, free, no key, Turkish and English, uses Microsoft's online speech service; a button cannot start it programmatically, so the button would focus the field and show the shortcut; (b) a local speech model (whisper.cpp through a native module or a helper process: private, offline, a model download of 150 MB–1.5 GB, GPU helps); (c) a speech-to-text service with a key (secure storage as model keys; the audio leaves the PC). Recommendation: (a) now (F1, no code beyond the button), (b) in F8 if typing by voice becomes daily use (decision D9).
- **Effects:** none; dictated text is ordinary thinking text.

## 4. Evidence summary

| Source of an answer | DSR | Seven states | Confidence calibration | Report |
| --- | --- | --- | --- | --- |
| Free recall (topic card) | as today | — | recall calibration as today | process history |
| Verified package item, first, unassisted | as today (bands, 2.2) | as today | main | as today |
| Verified item, any help (incl. model hint, side question) | no | `assisted` at best | main | help listed |
| Unverified or disputed package item | no | `uncertain` | excluded | as today |
| Probe question (generated) | no | no | "Generated questions" | probe column |
| Live predict / check (generated) | no | no (session evidence) | "Generated questions" | live session row |
| Generated practice, own problem | no | no (session evidence) | "Generated questions" | generated practice row |
| Graph node | no | displayed only | — | — |

## 5. Model slots and cost

Prober, planner, teacher and practice coach: **strong**; hint giver and side answerer: **fast**; graph extractor: **strong** (once per session); researcher: a provider with web search; photos (own problem, mind maps): **vision**. Every session shows its running cost like E3 jobs; a live session estimate is shown before it starts ("about N turns, $x" from the price table, or "free" / "in your subscription").

## 6. Without any model

Everything that works today keeps working. New things that need no model: thinking fields, the slider and the new calibration views, the packaged plan map with self-rating instead of a probe, the seeded graph and its view, the dictation button (Windows voice typing). Things that need a model show their usual "No model set up" hint and, where a prompt exists, "Copy prompt".

## 7. Where the screens go (for F1–F8)

- Study library: "Start live session" (free / with files / attached to a study), "Practice", and the sessions list (resume, transcripts).
- Topic navigator: the topic mode switch, "skipped after probe", the plan map in Priming.
- Applying: thinking box, slider, "Ask for a hint" (Practice mode), side panel.
- Evaluating: adaptive practice.
- Graph: a Study-mode entry next to Mind maps' group (decision D10).
- Stats: confidence calibration (banded + fine), "Generated questions" calibration.

## 8. Agent instructions (drafts in `prompts\`)

| File | Slot | Variables | Reply (built as a schema in its F task) |
| --- | --- | --- | --- |
| `prober.md` | strong | goal, strands, material, history | next question or done, strand status |
| `planner.md` | strong | goal, probe_result, material, change_request | nodes with dependencies, order |
| `teacher.md` | strong | plan, position, held, material, history, learner_turn | predict / teach / check / verdict |
| `practice-coach.md` | strong | outcomes, material, history, learner_turn | problem or verdict |
| `hint-giver.md` | fast | item, response, thinking, given, requested | level, stuck_at, hint |
| `graph-extractor.md` | strong | transcript, nearby | propositions, chains |
| `side-answerer.md` | fast | context, question | answer, uses, beyond_source, uncertain |
| `researcher.md` | strong + web search | claim, context, sources | verdict, brief, sources |

They are drafts: the F task that uses one finalises its text, adds `schema:` and raises `version`. They carry `status: draft`, the shared fragments they use (`includes:`) and their LearnHarness source (`adapted_from:`) in the front matter. Version 1 was written from the comparison notes only; version 2 adapts LearnHarness's own instructions (section 12). Shared fragments: `prompts\shared\voice.md`, `accuracy.md`, `thinking.md`, `confidence.md`, `side-conversations.md`.

## 9. Changes to STUDY-RULES.md (applied in task F1)

1. v2.1 table: Priming gains the optional "Find my level" probe (generated questions, never package items, no score, no gate); Learn & digest gains "Thinking while reading"; Evaluating becomes "adaptive practice with generated problems, or deferred".
2. v2.1 Navigation: a topic may be skipped after a probe by the learner's choice; it counts as complete for End and stays in the final test.
3. New v2.1a "Topic mode": `cycle` or `live`; a live topic replaces Learn & digest by an attached live session limited to its units; Applying unchanged.
4. v2.2 Ground rules: add "Generated during a session" (labelled, unverified, never the scheduler, never a package).
5. v2.4 Package schema: optional `outcomes[].proposition` and `relations[].premises` / `conclusion` (graph); recommended for new modules, not required by the audit.
6. v2.5 Items: help in Practice mode adds model hint rungs R0–R5; every rung is recorded and makes the attempt assisted; a statement repair (rewording what is asked) is recorded but is not help.
7. v2.8 DSR: confidence is a 0–100 slider; "Sure" = 80–100, "Unsure" = 40–79, "Guess" = 0–39; the table stays the same in bands; generated material never reaches DSR.
8. v2.9 Explain: the request includes the thinking text (renamed from "working").
9. v2.11 Audit: a warning (not a blocker) for outcomes without `proposition` only in modules written after the change; nothing for older ones.
10. New v2.13 "Sessions and the graph": what a live session and generated practice may show in the report (session evidence rows) and what they may not (states, DSR).

## 10. Build order (check of tasks F1–F8 in 04-prompt-plan.md)

| Order | Task | Change against the plan |
| --- | --- | --- |
| 0 | **E2** (study-time model calls) | Not built yet (E3 came first). Build it before F2: Explain, follow-ups and typed grading share the request plumbing the hint giver and side answerer need. Add the shared prompt fragments (`includes:`, D16) here. |
| 1 | **F1** thinking fields, slider, calibration | Drop "editable prompts" (done in E1). Add: the `cv: 3` migration of 2.8 for attempts, the `help` log, "I don't know" (D13), the banded + fine calibration views, and the dictation button that points to `Win + H` (D9). |
| 2 | **F2** hint ladder | As planned, with the R0–R5 rungs and the free statement repair of 3.4. |
| 3 | **F3** probe and plan map | Add: the `sessions` and `graph` containers in the store and the import report (2.4, 2.5, 2.8), and the **seeding module** of 3.10 (no UI), because the packaged plan map and the probe strands need the relations mapped to outcomes. |
| 4 | **F4** live teaching | As planned; includes the topic mode switch (1.3). |
| 5 | **F5** adaptive practice + own problem | As planned. |
| 6 | **F6** graph view and growth | Seeding is already there (F3); F6 is the view, evidence colouring, memory strength, extraction with identity candidates and coverage, review, and notes import (D15). |
| 7 | **F7** side questions, researcher | As planned. |
| 8 | **F8** dictation | Only if D9 = local model; otherwise it shrinks to the F1 button and can be dropped. |

Every task keeps: `npm test`, `npm run smoke` where Electron runs, a migration test on the real export when the state format changes, and an entry in this document's "as built" notes.

## 11. Decisions

**Decided 2026-11-16 (task F1): the owner accepted every recommendation below as written (D1–D17).** The table is kept as the record. Changing one later needs the owner's word and an edit here first. Task F1 applied them to `STUDY-RULES.md` (section 9 of this document, now done: v2.1, v2.1a, v2.2 rule 8, v2.4, v2.5, v2.8, v2.9, v2.11, v2.13). D16 (shared prompt fragments, `includes:`) was proposed with E2 but E2 did not build it; it is still open work for the first F task that needs a shared fragment.

| # | Question | Recommendation |
| --- | --- | --- |
| D1 | Can generated questions (probe, live checks, generated practice) move an outcome's evidence state? | **No.** The seven states stay driven by verified items only; generated work is shown as separate "session evidence" rows (n right without help / n) on the report and on graph nodes. Keys written by a model during a session are not checked like package items. |
| D2 | May an accepted live-session proposition become a review card? | **Not in F.** Cards come only from packages and lesson tests. If you want it later: a card you write yourself from the node (your words, `origin: learner`), never the model's text. |
| D3 | Confidence bands: 0–39 / 40–79 / 80–100? | **Yes.** It keeps "Sure" strict (only high confidence turns a right answer into Good), so the scheduler behaves as before. |
| D4 | Probe length budget? | **15 questions** at most, stop earlier when every strand is located; you can always stop it. |
| D5 | A topic skipped after a probe: does it count as complete for opening End, and stay in the final test? | **Yes and yes.** Skipping saves study time; the final test still checks it. |
| D6 | Target success rate of adaptive practice | **About 85 % per retrieval event** (per decision point, not per problem), as in LearnHarness: a several-step problem then succeeds as a whole less often, and hints rescue stalls. Changed from the first draft's "80 % per problem". |
| D7 | Confidence after a hint | Asking confidence **before** "Ask for a hint" can be pressed is too strict; **record confidence when the answer is committed, plus the highest hint rung**; assisted answers stay out of the fine calibration chart. |
| D8 | Researcher's search | **Only the configured provider's web search** (Anthropic) at first; no separate search key until you need it. |
| D9 | Dictation | **Windows voice typing (`Win + H`) now**, with a button that focuses the field and shows the shortcut; a local model in F8 only if you dictate daily. |
| D10 | Where the graph lives in the sidebar | **Study mode, next to Mind maps** in the "AI Mind Mapping Assistant" group, renamed "Maps" with two entries (Mind maps, Knowledge graph). |
| D11 | Live session cost guard | Show an estimate before a session and **stop at the monthly budget** like other API calls (already built); a per-session cap only if you want one. |
| D12 | Live sessions for exam topics (CEnT-S, TU Delft) | **Allowed only attached to the topic's study** (grounded in its extract); free sessions on exam topics would lose the source check. |
| D13 | "I don't know" (from LearnHarness) | **Add it everywhere confidence is asked.** On a verified package item it counts as not correct and is DSR-eligible as Again without the misconception flag (honest evidence of not knowing); on lesson tests it keeps today's score 0; excluded from confidence calibration. |
| D14 | End of a live session (from LearnHarness: "the goal feels obviously true") | **Ask it as a self-report at the end** (yes / not yet), shown in the session and the graph review, never used as evidence; "not yet" offers to continue or plan another session. |
| D15 | Notes import into the graph (from LearnHarness) | **Yes, in F6:** a notes file or a package's `source.md` runs through the extractor and the same review; nothing is stored without your decision. |
| D16 | Shared prompt fragments (from LearnHarness's prompt composition) | **Build `includes:` composition with E2**, so voice, accuracy, thinking and confidence rules are written once and every agent uses the same text; each fragment editable on its own. |
| D17 | Things LearnHarness has that this protocol leaves out (section 12) | **Leave out for now:** miss classification and demos (your earlier decision), mid-turn steering, the plugin system, the cloud dictation default. Reconsider steering after F4 if live sessions feel slow. |

## 12. LearnHarness review (2026-11-16, after the licence decision)

Read: LearnHarness 0.6.0 from the owner's zip: `docs/teaching-methodology.md`, the agent prompts (`src/agent/system-prompt.md`, `src/agent/prompts/{prober,teacher,practice,side-chat,shared}/*`), the graph contracts and extraction pipeline (`src/core/contracts/graph.ts`, `src/agent/subagents/extraction.ts`), the probe contract (`src/core/contracts/probe.ts`), the practice tool (`src/agent/tools/practice.ts`), the researcher (`src/agent/subagents/researcher.ts`) and the dictation module (`src/core/dictation.ts`). What follows is the verdict on each part: taken (adapted to Kartotek), changed, or left out.

| LearnHarness part | Verdict | How it lands in Kartotek |
| --- | --- | --- |
| Teaching theory: "held = obviously true", the goal feeling obviously true, the click, knowledge as structure | **Taken** | Teacher prompt; session end self-report (D14) |
| Minimal tree; foundations as unconditional truths; "how could I have discovered this?" | **Taken** | Planner and teacher prompts (3.6, 3.7) |
| Probe doctrine: goal first, strands, bracketing, enter near the top, strands inform each other | **Taken** | Prober prompt (3.5); Kartotek adds a question budget and grading in code |
| Plan as a coarse map, rewritten when teaching reveals gaps; every question tagged with node and type | **Taken** | 3.6, 3.7; Kartotek checks the map for cycles and unknown units |
| Predict → teach → check; checks behind "Check your understanding"; question principles | **Taken** | Teacher prompt; UI rule in F4 |
| Thinking fields as primary data, including thinking while reading | **Taken** (was already in the first draft) | `prompts\shared\thinking.md` |
| Confidence as probability, chance level, "I don't know" | **Taken** | 2.2, `prompts\shared\confidence.md`, D13 |
| Practice theory: inactivity, decision points, 85 % per retrieval event, interleaving, three modes, templates, selection rules, arc with retests, commit before posing, pause after a problem | **Taken** | Practice coach prompt, 3.8, D6 |
| Hint ladder R0–R5, first failing question, verification nudge, free statement repair, rung as difficulty readout | **Taken** | Hint giver prompt, 3.4 (replaces the first draft's L1–L5) |
| Miss classification (cue, discrimination, execution, careless, structural) | **Left out** | The owner ruled model error classification out of scope |
| Voice rules (no praise, no agreement bias, dry register) and accuracy rules (verify on doubt, say uncertainty out loud) | **Taken** | `prompts\shared\voice.md`, `accuracy.md`; Kartotek adds the package as the authority and "never claim mastery" |
| Side chat: never solves an open question; exchanges forwarded to the main agent | **Taken** | Side answerer prompt, 3.11 |
| Graph: name / statement / aliases, jointly-entailing chains, implication nodes, true ideas only, extractor + identity audit, coverage fingerprints, notes import | **Taken**, simplified | 3.10: the identity decision is folded into the extractor (Kartotek computes candidates locally) and the learner reviews everything, instead of a separate auditor model run |
| Graph without assessment | **Changed** | Records stay assessment-free, but the view shows evidence state and memory strength from Kartotek's evidence and scheduler |
| Researcher: facets, varied queries, authoritative sources, brief with findings and sources | **Taken** | Researcher prompt, 3.12; only with a provider that has web search (D8) |
| Prompt composition: base + agent fragments + shared fragments, per-fragment overrides | **Taken** | `includes:` (3.3, D16) |
| Agent loop with tools (probe, plan_init, quiz, problem, conclude) | **Changed** | Kartotek uses one structured JSON reply per call through its model layer; the same roles are fields of the reply (phase, node, type, outcome) |
| Dictation through Deepgram (cloud, key) | **Changed** | Windows voice typing first, local model as the alternative (D9); a cloud service with a key stays option (c) |
| Interactive demos, visual maker, SVG annotation | **Left out** | Owner decision (demos); Kartotek's packages already have `svg` and `anim` blocks |
| Plugins (flashcards, code questions, drawing pad) | **Left out for now** | Kartotek has its own scheduler and mind maps; no plugin system planned |
| Mid-turn steering and abort | **Left out for now** | Reconsider after F4 (D17) |
| Context compaction for long sessions | **Noted for F4** | Long live sessions send the plan, the held nodes and the last turns, not the whole transcript; LearnHarness's compaction is a reference if that is not enough |

What LearnHarness does not have and Kartotek keeps: the audited package and source ledger, verified items, strict DSR eligibility, the delayed final test and the outcome report, exam preparation, lesson tests and mock exams, mind maps from photos, and the evidence shown on graph nodes.

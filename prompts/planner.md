---
id: planner
title: Live session: plan map (draft)
version: 2
slot: strong
status: draft
includes: [shared/voice, shared/accuracy, shared/thinking]
adapted_from: LearnHarness 0.6.0, src/agent/prompts/teacher/05-method.md, 10-planning.md and docs/teaching-methodology.md sections 6-7 (Amos Blomqvist, AGPL-3.0-only)
variables: [goal, probe_result, material, change_request]
---
# The plan

Planning is the highest-leverage step of a session; do not rush it. With the learner's level and goal in hand, reason out the best way to teach *this thing* to *this person*.

Goal:
{{goal}}

What the probe found (per strand: floor, ceiling, misunderstandings, what to build from):
{{probe_result}}

The material the session is grounded in (source units with pages and their relations, or the learner's files):
{{material}}

The learner's request for changes (empty on the first draft):
{{change_request}}

## How to plan

- **Scope the field**: its core concepts, the real first principles, standard framings, common pitfalls. Where your picture is less than clear, list the claim in "uncertain" so it can be checked before teaching; planning is the natural moment for verification.
- **Find the unconditional truths** the goal rests on: facts the learner can accept at face value, with no caveats ("all X are Y", "no X is Y", a real definition, "ALL X is done through {…}" when the domain has such an atomic unit). If a fact needs conditions it is not an unconditional truth yet: dig further down. Small and solid beats large and shaky.
- **Prune what is held.** Build from what the probe showed, not below it and not above it. The plan is the **minimal tree**: nothing the learner already holds is re-taught, nothing off the path to the goal is taught however interesting, and the derivation to the goal is as short as the subject allows.
- **Find the motivated discovery path** from those truths to the goal: why would anyone reach for each step, what problem demands it? A good plan makes the teaching feel inevitable instead of arbitrary.
- **Choose Socratic or expository** per stretch: Socratic where the learner can plausibly reason their way there, expository where the step is beyond cold reasoning.
- **Stress-test the roots.** For every node treated as foundational, ask whether it is an unconditional truth *for this learner* or a disguised theorem that derives from something simpler they would accept. If it derives, push it down and extend the map.
- When the session is grounded in a Kartotek package, every node lists the unit ids it rests on and uses nothing else.

## The map

The map is a **map, not a syllabus**: nodes are structural landmarks (the unconditional truths at the bottom, the major stations, the goal at the top), not turns of teaching. A node may take one reasoning step or five. Edges are "requires" edges: the learner must understand the "from" node before the "to" node. Node ids are lowercase words joined by hyphens, chosen once and never changed. Size is free: as many nodes as the subject needs; correct structure is what keeps a map readable, not compression. The map is a hypothesis about the learner; teaching will revise it.

Respect the learner's change request unless it would make the path unsound; then say why.

Answer with JSON only: the approach in a few sentences of prose (what will be covered, in what order and why, given where the learner's edge sits), the nodes (id, label, kind "held" / "learn" / "goal", depends_on, units, why it is needed, mode "socratic" / "expository"), and "uncertain" (claims to check before teaching). Presenting the plan ends the turn: teaching starts only after the learner accepts it.

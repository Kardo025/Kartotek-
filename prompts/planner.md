---
id: planner
title: Live session: plan map (draft)
version: 1
slot: strong
status: draft
variables: [goal, probe_result, material, change_request]
---
You draw the shortest learning path from what the learner already holds to their goal, as a small dependency map. The learner sees the map, accepts it or asks for changes, and teaching follows it one node at a time.

Goal:
{{goal}}

What the probe found (per strand: held, edge or missing, with notes):
{{probe_result}}

The material the session is grounded in (units with pages and their relations, or the learner's files):
{{material}}

The learner's request for changes (empty on the first draft):
{{change_request}}

Rules:
- A node is one idea that can be taught in one or a few short steps and then checked: a definition with its conditions, a relation, a procedure with its assumptions, a formula with its variables and units. Never split a formula from its variables or a rule from its exception.
- Mark nodes the probe showed as held "held"; they stay on the map as foundations but are not taught. Mark the goal "goal"; everything between is "learn".
- Include only what the goal needs. Leave out interesting side topics; mention them in the notes instead.
- Every "learn" node depends on held nodes or earlier learn nodes; no cycles. When the session is grounded in a package, every node lists the unit ids it rests on and uses nothing else.
- Respect the learner's change request unless it would make the path unsound; then say why in the notes.

Answer with JSON only: nodes (id, label, kind, depends_on, units, why it is needed), the teaching order, and short notes for the learner.

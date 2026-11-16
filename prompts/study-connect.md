---
id: study-connect
title: Study writing: connecting items
version: 1
slot: strong
variables: [study, part, topics, latest, outcomes, units, text]
---
Write connecting items for one part of a Kartotek study: questions that need two or more topics together (for example a conversion that needs a prefix and a conversion factor, or a hypothesis that must also be testable). Write them only where the source supports a real link between the topics, typically 1–3. If the topics do not interact, answer with an empty list.

Study:
{{study}}

Part:
{{part}}

Topics so far (id, part, title):
{{topics}}

Every connecting item lists in "integrates" two or more of these topic ids, and at least one of them must be a topic of this part:
{{latest}}

Outcomes and criteria of these topics ("criteria" must come from the topics the item integrates):
{{outcomes}}

Units:
{{units}}

Follow the same rules as for practice items: the format fits the performance; options with ids and one note per option (the correct one starts with "Correct"); no "all of the above" or "none of the above"; typed items need a rubric and a model answer; numeric items need value, tol and unit; hints, steps and a solution with page or slide references; never refer to options by letter or position. Fill unused fields with "", [] or 0. Solve every item yourself before you fix its key.

Source pages:
{{text}}

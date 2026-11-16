---
id: mock-section
title: Mock exam: questions for one section
version: 1
slot: strong
variables: [exam, section, count, topics, mode, avoid, text]
---
Write questions for one section of a mock exam that simulates the real exam.

Exam:
{{exam}}

Section:
{{section}}

{{count}}

Syllabus topics of this section (tag each question with the matching id in "item_id"):
{{topics}}

How:
{{mode}}

For every question: "stem", "options" (the exam's number of options, one correct), "correct" (the index of the correct option, counting from 0), "solution" (1–4 sentences of reasoning, citing the page when a topic comes from a book), "refs" (page references, or []). Options are parallel in grammar and length; never "all of the above" or "none of the above"; one defensible answer; the key is not in the stem; never refer to options by letter or position in the solution, because Kartotek may reorder them. Solve every question yourself before you fix its key.

Do not repeat these questions:
{{avoid}}

Source pages:
{{text}}

# Mock exam authoring rules (Kartotek)

A mock exam simulates the real exam: the same sections, question counts, time limits, number of options and scoring. It is written to `mocks/<mock_id>/mock.json` and taken on the **Mock exam** tab of the exam section (CEnT-S or TU Delft AE Prep). The study rules in `STUDY-RULES.md` still apply where relevant: faithfulness to the sources, the Markdown subset and English only.

## 1. Format of the exams

**CEnT-S (CISIA, 2026-27 structure page):** 65 questions in 6 sections, taken in this order, each with its own time limit; when a section's time is up the next one starts, unused time is lost and there is no going back. Every question has **5 options, one correct**. Raw score: +1 correct, 0 blank, −0.25 wrong.

| section_id | Section | Questions | Minutes |
|---|---|---|---|
| read | Reading and comprehension | 10 | 30 |
| math | Mathematics | 15 | 30 |
| reason | Reasoning on texts and data | 15 | 30 |
| bio | Biology | 10 | 20 |
| chem | Chemistry | 10 | 20 |
| phys | Physics | 5 | 10 |

- Reading and comprehension: B2-level English texts of three kinds (non-fiction, literary, journalistic), 2–3 questions per text on the main idea, relations between parts, and implicit or implied meaning. Write original texts (or quote public-domain texts published before 1929); do not copy copyrighted articles. Put the text in the question's `passage` field; questions on the same text repeat the same `passage_id`.
- The other sections follow the CISIA syllabus in Kartotek (`src/cents-data.js`, `SYL`), drawn from the topics listed in the prompt.

**TU Delft AE selection exam:** sections and timing as in the prompt (Mathematics, Physics, First-year AE topics). Unless the user attaches an official sample that shows otherwise, use 4 options per question and no penalty (`"wrong": 0`).

## 2. Schema

```
{ mock_id, exam: "cents"|"tud", title, version, created_at, kind: "generated"|"past_paper", source?: "...",
  scoring: { correct: 1, wrong: -0.25, blank: 0 },
  sections: [{ section_id, name, minutes, questions: [
    { q_id (unique in the mock), item_id?: "<syllabus item id>", passage_id?, passage?: "<text, Markdown>",
      stem, options: [5 for CEnT-S | 4 for TU Delft], correct: index, solution, refs?: ["A&T 2e p. 131"] } ] }] }
```

- `item_id` links each question to a syllabus topic: the results page lists right / wrong / blank per topic with its pages, and wrong topics move up in the Overview's "Up next". Reading questions use `rc-1`.
- Section order, `section_id`, question counts and minutes must match the table (or the prompt for TU Delft).
- **Correct-option position:** the app does not shuffle options; spread the correct index evenly over all positions across the mock.
- `solution` explains the reasoning in 1–4 sentences and cites the page when the topic comes from a book.
- Difficulty: like the real exam: mostly application questions, a few harder ones; no trick questions.

## 3. Past papers

When the user attaches an official sample or past paper, set `kind: "past_paper"` and `source` to the paper's name, and transcribe it exactly as written (stems, options, figures described in words). Add `item_id` where a question clearly matches a syllabus topic. If the paper has no answer key, solve every question and say so in `source`.

## 4. Workflow and verification

1. Write the file, then validate it: `node -e "global.window=global;require('./src/mock-core.js');const e=KMock.validateMock(require('./mocks/<mock_id>/mock.json'));console.log(e.length?e:'ok')"`
2. Check the spread of `correct` over the options.
3. Run `build.ps1 -SkipPdf`; the mock is embedded as `bundled-mocks` and appears on the Mock exam tab.

## 5. Item quality gates (from Study Rules v2.2)

Check every generated question before validating (STUDY-RULES.md v2.6 has the full list):

1. **Consistency:** the passage, stem, numbers, options, `correct` index and `solution` describe the same problem.
2. **Solve it yourself** before fixing the key, and check every option.
3. **Recompute distractor explanations:** a solution that says an option "comes from using X instead of Y" must actually give that option's value under that error.
4. **Quantifiers and conventions:** check "always", "only", "must" and "can"; state the rounding, unit or notation convention when several valid ones exist.
5. **No cues:** options are parallel in grammar and length, the key is not in the stem, and there is no "all/none of the above". Each question has one defensible best answer.
6. **No filler distractors:** the exam's option count (5 for CEnT-S) is fixed, so redesign a question rather than adding a nonsense option.
7. **Past papers:** transcribe them exactly. When your own solution disagrees with the official key, keep the key and say so in `solution` ("The official key gives B; working from … gives D"), so the learner can check it.

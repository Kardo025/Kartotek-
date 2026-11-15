# End-of-lesson test authoring rules (Kartotek)

Use these rules when the user sends the material of a lesson they have just attended: a transcript, lecture notes, slides, or any combination of them. The output is `lessons/<name>/lesson.json`, shown on the **End-of-Lesson Test** tab. Everything is written in English. The study rules in `STUDY-RULES.md` still apply where relevant: faithfulness to the sources, balanced correct-option positions, the Markdown subset and the English-only rule.

## 1. Purpose

The test measures, objective by objective, what the user fully learned in the lesson and what they did not. Each objective becomes a DSR card, and its test result sets that card's first review and its whole review calendar. The test does not teach: there are no lesson blocks, and solutions are shown only at the end.

## 2. Reading the inputs

- **Transcripts**
  - `.txt`, `.md`, `.srt` and `.vtt` files are read with `Read`.
  - `.docx` files are read with Word COM (`Documents.Open(src, $false, $true)` then `.Content.Text`).
  - Keep timestamps when the transcript has them.
- **Notes (PDF):** read the whole file with `Read` and transcribe it page by page.
- **Slides:** `.pptx` is unzipped; `.ppt` is opened with PowerPoint COM (see STUDY-RULES.md §2).
- **Transcription file:** write everything to `lessons/<name>/source.md`, grouped by source. Include a "Not covered" list of things the sources only name without explaining.

## 3. Parts and objectives

- Split the lesson into parts that follow its own order, with 2–6 objectives per part.
- **One objective is one testable idea:** a fact, a concept or a procedure. Split objectives that combine several ideas.
- Each objective has:
  - `kind`: `fact`, `concept` or `problem`.
  - A measurable `objective` sentence ("Without notes, calculate …").
  - `refs`: where it is in the sources, e.g. `"slide 4"`, `"notes p. 2"`, `"transcript 12:40"`. The refs are shown as a "Restudy first" list when the objective is not learned.

## 4. Items: what is asked

Every objective has one **write-from-memory** item (`recall`). It comes before the multiple-choice items of its part so the options cannot cue it.
- `prompt` asks for production, not recognition.
- `model_answer` is 1–3 sentences.
- `key_points` has 2–4 checkable points; the user ticks them in the self-check.

**Multiple-choice items with `role: "test"`** are added according to the objective's `kind`. The total per objective, recall included, is **at most 4**.

| `kind` | test items | typical levels |
|---|---|---|
| fact | 1 | understand |
| concept | 2 | understand + transfer |
| problem | 2–3 | apply / calculate (+ transfer) |

- **Re-test pool:** add 2–3 items with `role: "retest"` per objective. They are not asked in the first test; a re-test uses 2 unused ones per due objective.
- **Options:** exactly 4. Distractors come from real confusions in the lesson.
  - `solution` explains the answer with refs.
  - `distractor_notes` has 4 entries; the correct index is "Correct.".
- **Correct-option position:** spread it evenly over 0–3 across the whole package. The app does not shuffle options.
- Numbers in new situations are allowed when they apply the lesson's own formulas; new facts are not.

## 5. Scoring (built into the app)

| Item | Score |
|---|---|
| Multiple choice, correct + Sure / Unsure / Guess | 1 / 0.7 / 0.4 |
| Multiple choice, wrong or "Don't know" | 0 (wrong + Sure = misconception) |
| Write from memory | share of key points ticked (0 if nothing was written) |

The objective score is the mean of its item scores. Each objective gets one DSR event (`source: "lesson"`, `signal: "lesson" | "retest"`):

| Level | Condition | DSR rating | First review of a new card |
|---|---|---|---|
| Mastered | score ≥ 0.9 and no wrong answer | easy | 3 days |
| Learned | ≥ 0.7 | good | 1 day |
| Partly learned | ≥ 0.45 | hard | 10 min (today) |
| Not learned | < 0.45 or a misconception | again | 10 min (today) |

The calendar projects each objective's next reviews with `DSR.processReview`, assuming "Good" at every review.
- Reviews on the Review tab and re-tests update it.
- Lesson events do not use the Review tab's daily limits and are not used for calibration.

## 6. Schema

```
{ lesson_id, title, version, created_at, lesson_date?, sources:[{file, type:"transcript|notes|slides", note?}],
  parts:[{ part_id, title, refs?:[..],
    objectives:[{ objective_id (unique), kind:"fact|concept|problem", title, objective, refs:[..],
      recall:{ prompt, model_answer, key_points:[..] },
      items:[{ q_id (unique), role:"test"|"retest", level?:"understand"|"apply"|"transfer"|"calculate",
               stem, options:[4], correct:0-3, solution, distractor_notes:[4] }] }] }] }
```

- `lesson_id` uses letters, digits and `- _ .`, preferably the folder name.
- Increase `version` when the content changes; cards and their DSR history are kept.

## 7. Workflow and verification

1. Write `source.md`, then `lesson.json`.
2. Check the correct-option distribution (`Group-Object correct` over all items).
3. Run `build.ps1 -SkipPdf`; the package is embedded as `bundled-lessons`.
4. Verify in headless Edge:
   - All tests on `#algo` pass.
   - The lesson is listed on `#lesson`.
   - The e2e driver `%TEMP%\ktchk\lesson-e2e.html` runs.
5. Copy the build to `Downloads\Kartotek-DSR.html` and `Documents\Kartotek\kartotek\Kartotek-DSR.html`.

## 8. Placement tests (diagnostic)

A placement test tells the user which syllabus topics they already know, before studying them. It is an ordinary lesson-test package with these differences:

- `lesson_id` is `place-<exam>-<section>-<block>` (the prompt gives it) and the package has `"placement": {"exam": "...", "section": "...", "block": N}`.
- One part. **One objective per syllabus topic**, and `objective_id` is exactly the topic's item id given in the prompt (for example `at2.5`). The Overview page reads the results by these ids.
- Each objective: a short write-from-memory `recall` (one question whose `key_points` are the 2–3 ideas a person who knows the topic would write) and **2 `test` items** of level `apply` or `transfer`. No `retest` items are needed.
- Questions must be answerable by someone who already knows the topic and hard to guess for someone who does not: no definitions that can be recognised from the options alone, real distractors from typical mistakes.
- Everything else (4 options, balanced correct positions, solutions with page refs, English only) follows the rules above.

The app maps the result of each objective to the topic: Mastered or Learned marks the topic as known (it moves to the end of "Up next"), Partly or Not learned keeps it in the plan. The objective cards are scheduled by DSR like any lesson-test card.

## 9. Item quality gates (from Study Rules v2.2)

Check every item before validating the package (STUDY-RULES.md v2.6 has the full list):

1. **Consistency:** the stem, numbers, options, `correct` index, `solution` and `distractor_notes` describe the same problem.
2. **Solve it yourself** before fixing the key, and check every option against the sources.
3. **Recompute distractor notes:** a note such as "comes from using X instead of Y" must actually give that option's value when you make that error. Otherwise say only that the option is incorrect.
4. **Quantifiers:** check "always", "only", "must" and "can" against the source. A common pattern is not a universal rule.
5. **Conventions:** state the method when several valid ones exist (rounding, units, notation). If the lesson uses a simplified rule, keep it and label its scope.
6. **No cues:** options are parallel in grammar and length, the key is not in the stem, and there is no "all/none of the above". Each item has one defensible best answer.
7. **No filler distractors:** if three plausible wrong options cannot be written, test that idea with the write-from-memory item or redesign the question. Never add a nonsense option to reach four.
8. **Retest items are new tasks.** Shuffled options or reworded stems are not new items.

Lesson-test packages keep their fixed format: 4 options, a `correct` index and no shuffling, with balanced positions. Study v2's variable option counts and select-all items are not available here.

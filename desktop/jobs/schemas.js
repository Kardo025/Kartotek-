'use strict';
// JSON Schemas of the writing steps (task E3). Written to the strictest common subset (ARCHITECTURE.md 5.2): every object lists all
// its properties as required and has additionalProperties false; no length or number limits; no recursion. Fields that do not
// apply to a format are filled with empty values by the model and removed by the step code. The schemas live in code (not in
// prompts\schemas\) because the step code depends on their exact shape; the prompt texts stay editable files.

const obj = (props) => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false });
const str = { type: 'string' };
const num = { type: 'number' };
const int = { type: 'integer' };
const bool = { type: 'boolean' };
const arr = (items) => ({ type: 'array', items });
const strs = arr(str);
const en = (values) => ({ type: 'string', enum: values });

const UNIT_TYPES = ['definition', 'proposition', 'relation', 'procedure', 'equation', 'condition', 'exception', 'example', 'figure', 'table', 'exercise'];
const KINDS = ['olgu', 'kavram', 'problem', 'yazma', 'uygulama'];
const BLOCK_TYPES = ['text', 'example', 'analogy', 'keypoints', 'callout', 'steps', 'compare', 'worked'];
const FORMATS = ['mcq_single', 'mcq_multi', 'typed', 'numeric'];
const PERFORMANCE = ['identify', 'distinguish', 'explain', 'solve', 'transfer', 'recall'];

const keyword = obj({ term: str, definition: str, ref: str });
const block = obj({
  type: en(BLOCK_TYPES), title: str, md: str, tone: en(['dikkat', 'ipucu', 'none']), items: strs,
  columns: strs, rows: arr(strs), problem: str, steps: arr(obj({ do: str, why: str })), answer: str, refs: strs, slides: arr(int),
});
const item = obj({
  format: en(FORMATS), performance: en(PERFORMANCE), difficulty: en(['basic', 'medium', 'hard']), origin: en(['imported', 'adapted', 'generated']),
  source_ref: str, units: strs, criteria: strs, integrates: strs, stem: str,
  options: arr(obj({ id: str, md: str })), key: strs, option_notes: arr(obj({ id: str, note: str })),
  numeric: obj({ value: num, tol: num, unit: str }),
  rubric: obj({ criteria: arr(obj({ id: str, text: str, required: bool })), accept: strs, contradictions: strs, model: str }),
  hints: strs, steps: arr(obj({ do: str, why: str })), solution: str,
});

const S = {
  transcribe: obj({ text: str, unreadable: strs, figures: arr(obj({ what: str, description: str })) }),
  units: obj({
    title: str, conventions: strs,
    units: arr(obj({ source: str, loc: str, type: en(UNIT_TYPES), text: str, disposition: en(['included', 'out_of_scope', 'unresolved']), reason: str })),
    gaps: arr(obj({ what: str, why: str })), not_covered: strs,
  }),
  relations: obj({ relations: arr(obj({ from: str, to: str, type: en(['dependency', 'causal', 'comparative', 'compositional', 'sequential', 'conditional']), direction: en(['forward', 'bidirectional']), conditions: strs, units: strs })) }),
  outline: obj({
    title: str,
    parts: arr(obj({
      title: str,
      topics: arr(obj({
        title: str, kind: en(KINDS), objective: str,
        outcomes: arr(obj({ performance: str, object: str, conditions: str, units: strs, relations: strs, criteria: strs })),
      })),
    })),
    unresolved_units: arr(obj({ unit: str, reason: str })),
  }),
  topic: obj({
    priming: obj({ summary_md: str, keywords: arr(keyword), purpose: str, prereq: str }),
    blocks: arr(block),
    recall: obj({ prompt: str, model_answer: str, key_points: strs, origin: en(['imported', 'adapted', 'generated']), source_ref: str }),
    feynman: obj({ prompt: str, criteria: strs }),
  }),
  part: obj({
    orientation: obj({ place: str, purpose: str, prereq: str }),
    summary: obj({ md: str, keywords: arr(keyword) }),
    connect_blocks: arr(block),
    feynman: obj({ prompt: str, criteria: strs }),
  }),
  items: obj({ items: arr(item) }),
  solve: obj({ answers: arr(obj({ ref: str, choice: strs, answer: str, number: str, confidence: en(['sure', 'unsure', 'cannot_solve']), reasoning: str })) }),
  judge: obj({ criteria: arr(obj({ id: str, met: bool, quote: str })), contradiction: bool, note: str }),
  fix: obj({ verdict: en(['key_correct', 'item_fixed', 'cannot_tell']), note: str, item }),
  // end-of-lesson tests (LESSON-TEST-RULES.md): fixed format, 4 options and a correct index
  lessonOutline: obj({
    title: str,
    parts: arr(obj({ title: str, refs: strs, objectives: arr(obj({ title: str, kind: en(['fact', 'concept', 'problem']), objective: str, refs: strs })) })),
    not_covered: strs,
  }),
  lessonItems: obj({
    objectives: arr(obj({
      ref: str,
      recall: obj({ prompt: str, model_answer: str, key_points: strs }),
      items: arr(obj({ role: en(['test', 'retest']), level: en(['understand', 'apply', 'transfer', 'calculate']), stem: str, options: strs, correct: int, solution: str, distractor_notes: strs })),
    })),
  }),
  // mock exams (MOCK-RULES.md)
  mockQuestions: obj({
    questions: arr(obj({ item_id: str, passage_id: str, passage: str, stem: str, options: strs, correct: int, solution: str, refs: strs })),
  }),
  // mind maps: the reading and the coaching turn are checked by KMind's own validators (their payloads vary by object kind)
  mindMap: { type: 'object' },
  mindTurn: { type: 'object' },
};

module.exports = { S, UNIT_TYPES, KINDS, BLOCK_TYPES, FORMATS, PERFORMANCE };

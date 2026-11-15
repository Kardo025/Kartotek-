'use strict';
// Typed errors of the model layer (ARCHITECTURE.md section 5.1), so the window can say what to do.
const CODES = ['not-configured', 'auth', 'rate-limit', 'budget', 'network', 'schema', 'cancelled', 'cli-missing', 'provider', 'refused', 'timeout', 'invalid'];

class ModelError extends Error {
  constructor(code, message) {
    super(message);
    this.code = CODES.indexOf(code) >= 0 ? code : 'provider';
  }
}

const ADVICE = {
  'not-configured': 'Set up a model in Settings, Models.',
  auth: 'Check the API key or sign in to the command-line client again.',
  'rate-limit': 'Wait a moment and try again.',
  budget: 'This month\'s budget is used up. Raise it in Settings, Models, Usage, or allow one more call.',
  network: 'Check the internet connection, or that the local server is running.',
  schema: 'The model\'s answer did not have the required shape, even after one repair attempt.',
  cancelled: '',
  'cli-missing': 'Install the command-line client, or set its full path in Settings, Models.',
  provider: '',
  refused: 'Rephrase the request or use another model.',
  timeout: 'The call took too long. Try again or choose a faster model.',
  invalid: '',
};

function toPlain(e) {
  const err = e instanceof ModelError ? e : new ModelError('provider', String((e && e.message) || e));
  return { code: err.code, message: err.message, advice: ADVICE[err.code] || '' };
}

module.exports = { ModelError, toPlain, CODES };

const { newId, now } = require('./helpers');

/**
 * Append an event to a draft inside an active transaction.
 * Call this from within a store.withTransaction() callback so the log entry
 * commits atomically with whatever it's describing.
 */
function logEventInDraft(draft, { type, userId = null, details = {} }) {
  draft.events.push({
    id: newId('evt'),
    type,
    userId,
    details,
    createdAt: now()
  });
}

/**
 * Fire-and-forget logging for actions that aren't already inside a
 * transaction (e.g. login attempts, OTP requests).
 */
const store = require('./store');
async function logEvent(type, userId, details) {
  await store.withTransaction(async (draft) => {
    logEventInDraft(draft, { type, userId, details });
  });
}

module.exports = { logEventInDraft, logEvent };

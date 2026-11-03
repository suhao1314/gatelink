'use strict';
function validShareToken(token) { return typeof token === 'string' && /^[a-zA-Z0-9]{20}$/.test(token); }
function usableShare(row, now) { return !!row && row.enabled === 1 && ['summary', 'full'].includes(row.scope) && Number.isSafeInteger(row.expires_at) && row.expires_at >= 0 && (row.expires_at === 0 || row.expires_at > now); }
module.exports = { validShareToken, usableShare };

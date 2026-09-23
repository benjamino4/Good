'use strict';
// Minimal Telegram Bot API client (no external deps, Node 16+ compatible).
const https = require('https');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

function callApi(method, params) {
  return new Promise((resolve, reject) => {
    if (!BOT_TOKEN) return reject(new Error('no_bot_token'));
    const body = JSON.stringify(params || {});
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.ok) resolve(j.result);
          else reject(new Error(j.description || 'tg_error'));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Create a Telegram Stars invoice link.
 * Stars invoices use currency 'XTR' and an empty provider_token.
 * `prices` is [{ label, amount }] where amount is the number of Stars.
 */
function createStarsInvoiceLink({ title, description, payload, stars }) {
  return callApi('createInvoiceLink', {
    title,
    description,
    payload,                       // opaque string we get back on success
    provider_token: '',            // MUST be empty for Stars
    currency: 'XTR',
    prices: [{ label: title, amount: stars }],
  });
}

function answerPreCheckoutQuery(id, ok = true, error_message) {
  return callApi('answerPreCheckoutQuery', { pre_checkout_query_id: id, ok, error_message });
}

function sendMessage(chat_id, text) {
  return callApi('sendMessage', { chat_id, text }).catch(() => {});
}

// Refund a Stars payment (e.g. failed fulfilment)
function refundStarPayment(user_id, telegram_payment_charge_id) {
  return callApi('refundStarPayment', { user_id, telegram_payment_charge_id });
}

module.exports = { callApi, createStarsInvoiceLink, answerPreCheckoutQuery, sendMessage, refundStarPayment, BOT_TOKEN };

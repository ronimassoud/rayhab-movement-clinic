/* Rayhab, payments API (contracts in README.md).

   Patient, through the secure link's opaque token:
     selection(token)                 GET  /api/payment-selection
     choose(token, method, key)       POST /api/payment-selection
     answerNewTime(token, accept, key) POST /api/payment-selection/reschedule
     The token goes in the X-Payment-Token header, never in the URL, so
     it stays out of request logs.
     whishCheckout(token, key)        POST /api/payments/whish/create

   Staff:
     list(filters)                    GET  /api/admin/payments?...
     confirmCash(id, body, key)       POST /api/admin/payments/:id/confirm-cash

   Nothing here can mark a payment paid. A Whish payment is paid when the
   backend has verified it with Whish; cash is paid when an authorized staff
   member records the receipt. The pages only read the result. */
(function () {
  'use strict';
  var api = window.RayhabAPI;
  if (!api) return;
  function tok(t) { return { 'X-Payment-Token': String(t || '') }; }
  api.payments = {
    selection: function (token) { return api.get('/payment-selection', { timeout: 10000, headers: tok(token) }); },
    choose: function (token, method, key) { return api.post('/payment-selection', { method: method }, { key: key, headers: tok(token) }); },
    // A new time the clinic proposed: accept it, or ask for another.
    answerNewTime: function (token, accept, key) { return api.post('/payment-selection/reschedule', { accept: !!accept }, { key: key, headers: tok(token) }); },
    whishCheckout: function (token, key) { return api.post('/payments/whish/create', { token: token }, { key: key, timeout: 20000 }); },
    list: function (f) { return api.get('/admin/payments' + api.qs(f), { timeout: 10000 }); },
    confirmCash: function (id, body, key) {
      return api.post('/admin/payments/' + encodeURIComponent(id) + '/confirm-cash', body, { key: key });
    }
  };
})();

/* Rayhab, availability API (contracts in README.md).

     services()                       GET /api/services
     slots({ service_id, practitioner_id, mode, date })
                                      GET /api/availability?...

   Reads only. Short timeouts: the booking flow falls back to the clinic's
   usual hours when these cannot be reached, so waiting long helps nobody. */
(function () {
  'use strict';
  var api = window.RayhabAPI;
  if (!api) return;
  api.availability = {
    services: function () { return api.get('/services', { timeout: 8000 }); },
    slots: function (q) { return api.get('/availability' + api.qs(q), { timeout: 8000 }); }
  };
})();

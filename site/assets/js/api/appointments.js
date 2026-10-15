/* Rayhab, appointments API (contracts in README.md).

   Patient:
     create(payload, key)             POST /api/appointments

   Staff (cookie session, X-CSRF-Token on every change):
     session()                        GET  /api/admin/session
     overview()                       GET  /api/admin/overview
     list(filters)                    GET  /api/admin/appointments?...
     get(id)                          GET  /api/admin/appointments/:id
     approve|decline|reschedule|cancel|complete|noShow(id, body, key)
                                      POST /api/admin/appointments/:id/<action>
     schedule(range)                  GET  /api/admin/availability?...
     updateSchedule(body, key)        PATCH /api/admin/availability
     audit(filters)                   GET  /api/admin/audit?...

   Every change answers with the record as the server now holds it; the
   pages show that, never their own idea of what the change did. */
(function () {
  'use strict';
  var api = window.RayhabAPI;
  if (!api) return;
  function act(name) {
    return function (id, body, key) {
      return api.post('/admin/appointments/' + encodeURIComponent(id) + '/' + name, body || {}, { key: key });
    };
  }
  api.appointments = {
    create: function (payload, key) { return api.post('/appointments', payload, { key: key, timeout: 15000 }); },
    session: function () { return api.get('/admin/session', { timeout: 10000 }); },
    overview: function () { return api.get('/admin/overview', { timeout: 10000 }); },
    list: function (f) { return api.get('/admin/appointments' + api.qs(f), { timeout: 10000 }); },
    get: function (id) { return api.get('/admin/appointments/' + encodeURIComponent(id), { timeout: 10000 }); },
    approve: act('approve'),
    decline: act('decline'),
    reschedule: act('reschedule'),
    cancel: act('cancel'),
    complete: act('complete'),
    noShow: act('no-show'),
    schedule: function (q) { return api.get('/admin/availability' + api.qs(q), { timeout: 10000 }); },
    updateSchedule: function (body, key) { return api.patch('/admin/availability', body, { key: key }); },
    audit: function (f) { return api.get('/admin/audit' + api.qs(f), { timeout: 10000 }); }
  };
})();

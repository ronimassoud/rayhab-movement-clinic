/* Rayhab, clinic time.

   The clinic works in Beirut time (Asia/Beirut), which moves between GMT+2
   in winter and GMT+3 in summer. Two rules keep dates and times honest:

     - A calendar day is a 'yyyy-mm-dd' string, and date arithmetic is done on
       UTC midnights. The visitor's own time zone and its daylight-saving
       changes never shift a day.
     - A clinic time is a Beirut wall time ('09:00' on a given day). It is
       turned into a real instant only through Intl, which knows Beirut's
       rules, never by assuming a fixed offset.

   Loaded as a plain script it sets window.RayhabTime; under Node it is a
   CommonJS module, so tests/time.test.js can check the transitions. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RayhabTime = api;
})(this, function () {
  'use strict';

  var TZ = 'Asia/Beirut';
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MON_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                  'August', 'September', 'October', 'November', 'December'];

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  var fmtCache = {};
  function formatter(tz) {
    if (!fmtCache[tz]) {
      fmtCache[tz] = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    }
    return fmtCache[tz];
  }

  // The wall-clock reading of an instant in a zone.
  function partsIn(ms, tz) {
    var out = {};
    formatter(tz || TZ).formatToParts(new Date(ms)).forEach(function (p) {
      if (p.type !== 'literal') out[p.type] = parseInt(p.value, 10);
    });
    if (out.hour === 24) out.hour = 0;   // older engines write midnight as 24
    return out;
  }

  // Minutes the zone is ahead of UTC at that instant (Beirut: 120 or 180).
  function offsetMinutes(ms, tz) {
    var p = partsIn(ms, tz);
    var wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return Math.round((wall - Math.floor(ms / 1000) * 1000) / 60000);
  }

  /* ---- Calendar days ---- */
  function parseDay(iso) {
    var q = String(iso).split('-');
    return Date.UTC(+q[0], +q[1] - 1, +q[2]);
  }
  function isoDay(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function addDays(iso, n) { return isoDay(parseDay(iso) + n * 86400000); }
  function daysBetween(a, b) { return Math.round((parseDay(b) - parseDay(a)) / 86400000); }
  function dow(iso) { return new Date(parseDay(iso)).getUTCDay(); }
  function dayParts(iso) {
    var d = new Date(parseDay(iso));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth(), date: d.getUTCDate(), dow: d.getUTCDay() };
  }

  // Today's date in Beirut, whatever the visitor's own clock says.
  function today(now) {
    var p = partsIn(now == null ? Date.now() : now, TZ);
    return p.year + '-' + pad2(p.month) + '-' + pad2(p.day);
  }

  /* ---- Beirut wall time to an instant ----
     Guess with the offset at the wall time read as UTC, then correct with
     the offset at the guess. Two passes settle every case, including the
     days the clocks change. */
  function toUtc(isoDate, hhmm, tz) {
    tz = tz || TZ;
    var d = String(isoDate).split('-'), t = String(hhmm || '00:00').split(':');
    var wall = Date.UTC(+d[0], +d[1] - 1, +d[2], +t[0], +t[1]);
    var guess = wall - offsetMinutes(wall, tz) * 60000;
    return wall - offsetMinutes(guess, tz) * 60000;
  }

  // "GMT+3" in summer, "GMT+2" in winter, for that day and time.
  function offsetLabel(isoDate, hhmm) {
    var m = offsetMinutes(toUtc(isoDate, hhmm || '12:00'), TZ);
    var sign = m < 0 ? '-' : '+', a = Math.abs(m);
    return 'GMT' + sign + Math.floor(a / 60) + (a % 60 ? ':' + pad2(a % 60) : '');
  }

  function browserZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; }
  }

  /* For a visitor outside Lebanon: the same clinic time on their own clock,
     or '' when their clock already reads Beirut time. */
  function localHint(isoDate, hhmm, zone) {
    zone = zone || browserZone();
    if (!zone || zone === TZ) return '';
    var ms = toUtc(isoDate, hhmm);
    if (offsetMinutes(ms, zone) === offsetMinutes(ms, TZ)) return '';
    var p = partsIn(ms, zone);
    var mine = p.year + '-' + pad2(p.month) + '-' + pad2(p.day);
    var label = pad2(p.hour) + ':' + pad2(p.minute);
    if (mine !== isoDate) label += ' on ' + DOW[dow(mine)] + ' ' + p.day + ' ' + MON[p.month - 1];
    return label;
  }

  // An instant as Beirut date and time, from an ISO string the API returns.
  function fromInstant(isoUtc) {
    var ms = typeof isoUtc === 'number' ? isoUtc : Date.parse(isoUtc);
    var p = partsIn(ms, TZ);
    return { date: p.year + '-' + pad2(p.month) + '-' + pad2(p.day), time: pad2(p.hour) + ':' + pad2(p.minute) };
  }

  // iCalendar UTC stamp: 20261020T060000Z.
  function icsStamp(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + 'T' +
           pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
  }

  /* ---- Words ---- */
  function dayLabel(iso, full) {
    var p = dayParts(iso);
    return full
      ? DOW_FULL[p.dow] + ' ' + p.date + ' ' + MON_FULL[p.month]
      : DOW[p.dow] + ' ' + p.date + ' ' + MON[p.month];
  }
  function dayLabelYear(iso) {
    var p = dayParts(iso);
    return DOW_FULL[p.dow] + ' ' + p.date + ' ' + MON_FULL[p.month] + ' ' + p.year;
  }

  function toMin(hhmm) { var q = String(hhmm).split(':'); return (+q[0]) * 60 + (+q[1]); }
  function fromMin(m) { return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60); }

  return {
    TZ: TZ, DOW: DOW, DOW_FULL: DOW_FULL, MON: MON, MON_FULL: MON_FULL,
    pad2: pad2, partsIn: partsIn, offsetMinutes: offsetMinutes,
    parseDay: parseDay, isoDay: isoDay, addDays: addDays, daysBetween: daysBetween,
    dow: dow, dayParts: dayParts, today: today, toUtc: toUtc,
    offsetLabel: offsetLabel, browserZone: browserZone, localHint: localHint,
    fromInstant: fromInstant, icsStamp: icsStamp, dayLabel: dayLabel,
    dayLabelYear: dayLabelYear, toMin: toMin, fromMin: fromMin
  };
});

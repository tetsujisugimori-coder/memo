(function initStatusTimeUtils(globalScope) {
  "use strict";

  function validLocalDate(value) {
    if (value === null || value === undefined || value === "") return null;
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function padTimePart(value) {
    return String(value).padStart(2, "0");
  }

  function localDateTimeParts(value) {
    const date = validLocalDate(value);
    if (!date) return null;
    return {
      date,
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hours: padTimePart(date.getHours()),
      minutes: padTimePart(date.getMinutes()),
      seconds: padTimePart(date.getSeconds())
    };
  }

  function formatNoteDateTime(value) {
    const parts = localDateTimeParts(value);
    return parts ? `${parts.year}/${parts.month}/${parts.day} ${parts.hours}:${parts.minutes}` : "—";
  }

  function formatSaveSuccessTime(value) {
    const parts = localDateTimeParts(value);
    return parts ? `${parts.month}/${parts.day} ${parts.hours}:${parts.minutes}` : "—";
  }

  function formatDateTimeWithSeconds(value) {
    const parts = localDateTimeParts(value);
    return parts ? `${parts.year}/${parts.month}/${parts.day} ${parts.hours}:${parts.minutes}:${parts.seconds}` : "—";
  }

  const api = { formatDateTimeWithSeconds, formatNoteDateTime, formatSaveSuccessTime, validLocalDate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalScope.MemoNexusStatusTimeUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

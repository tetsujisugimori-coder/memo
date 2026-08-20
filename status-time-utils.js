(function initStatusTimeUtils(globalScope) {
  "use strict";

  const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
  const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

  function localDateFromParts(parts) {
    const [year, month, day, hours = "0", minutes = "0", seconds = "0", milliseconds = "0"] = parts;
    const date = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hours),
      Number(minutes),
      Number(seconds),
      Number(milliseconds.padEnd(3, "0"))
    );
    return date.getFullYear() === Number(year)
      && date.getMonth() === Number(month) - 1
      && date.getDate() === Number(day)
      && date.getHours() === Number(hours)
      && date.getMinutes() === Number(minutes)
      && date.getSeconds() === Number(seconds)
      ? date
      : null;
  }

  function dateOnlyParts(value) {
    if (typeof value !== "string") return null;
    const match = value.match(DATE_ONLY_PATTERN);
    if (!match) return null;
    const date = localDateFromParts(match.slice(1));
    return date ? { date, year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
  }

  function validLocalDate(value) {
    if (value === null || value === undefined || value === "") return null;
    if (value instanceof Date) {
      const date = new Date(value.getTime());
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value === "string") {
      const dateOnly = dateOnlyParts(value);
      if (dateOnly) return dateOnly.date;
      const localDateTime = value.match(LOCAL_DATE_TIME_PATTERN);
      if (localDateTime) return localDateFromParts(localDateTime.slice(1));
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function padTimePart(value) {
    return String(value).padStart(2, "0");
  }

  function zonedDateTimeParts(date, timeZone) {
    try {
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      });
      const values = Object.fromEntries(
        formatter.formatToParts(date)
          .filter((part) => part.type !== "literal")
          .map((part) => [part.type, part.value])
      );
      return {
        date,
        year: Number(values.year),
        month: Number(values.month),
        day: Number(values.day),
        hours: padTimePart(values.hour),
        minutes: padTimePart(values.minute),
        seconds: padTimePart(values.second)
      };
    } catch {
      return null;
    }
  }

  function localDateTimeParts(value, options = {}) {
    const dateOnly = dateOnlyParts(value);
    if (dateOnly) {
      return {
        ...dateOnly,
        hours: "00",
        minutes: "00",
        seconds: "00"
      };
    }
    const date = validLocalDate(value);
    if (!date) return null;
    if (options.timeZone) return zonedDateTimeParts(date, options.timeZone);
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

  function formatNoteDateTime(value, options = {}) {
    const parts = localDateTimeParts(value, options);
    return parts ? `${parts.year}/${parts.month}/${parts.day} ${parts.hours}:${parts.minutes}` : "—";
  }

  function formatSaveSuccessTime(value, options = {}) {
    const parts = localDateTimeParts(value, options);
    return parts ? `${parts.month}/${parts.day} ${parts.hours}:${parts.minutes}` : "—";
  }

  function formatDateTimeWithSeconds(value, options = {}) {
    const parts = localDateTimeParts(value, options);
    return parts ? `${parts.year}/${parts.month}/${parts.day} ${parts.hours}:${parts.minutes}:${parts.seconds}` : "—";
  }

  function formatLocalDate(value, options = {}) {
    const parts = localDateTimeParts(value, options);
    return parts ? `${parts.year}/${parts.month}/${parts.day}` : "";
  }

  function localDateKey(value, options = {}) {
    const parts = localDateTimeParts(value, options);
    return parts ? `${parts.year}-${padTimePart(parts.month)}-${padTimePart(parts.day)}` : "";
  }

  function isSameLocalDate(left, right, options = {}) {
    const leftKey = localDateKey(left, options);
    return Boolean(leftKey) && leftKey === localDateKey(right, options);
  }

  function timestampValue(value) {
    return validLocalDate(value)?.getTime() ?? null;
  }

  function compareDateTimes(left, right, order = "asc") {
    const leftTime = timestampValue(left);
    const rightTime = timestampValue(right);
    if (leftTime === null && rightTime === null) return 0;
    if (leftTime === null) return 1;
    if (rightTime === null) return -1;
    const comparison = leftTime - rightTime;
    return order === "desc" ? -comparison : comparison;
  }

  function dateTimeAttribute(value) {
    const dateOnly = dateOnlyParts(value);
    if (dateOnly) return value;
    const date = validLocalDate(value);
    return date ? date.toISOString() : "";
  }

  const api = {
    compareDateTimes,
    dateTimeAttribute,
    formatDateTimeWithSeconds,
    formatLocalDate,
    formatNoteDateTime,
    formatSaveSuccessTime,
    isSameLocalDate,
    localDateKey,
    timestampValue,
    validLocalDate
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalScope.MemoNexusStatusTimeUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

function partsMap(formatter, date) {
  return Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
}

export function localDateTimeParts({ now = new Date(), timeZone }) {
  if (!timeZone) throw new Error("timeZone is required");
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = partsMap(formatter, now);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

export function addDays(dateValue, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateValue))) {
    throw new Error("dateValue must use YYYY-MM-DD");
  }
  if (!Number.isInteger(days)) throw new Error("days must be an integer");
  const date = new Date(`${dateValue}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function tomorrowDate({ now = new Date(), timeZone }) {
  return addDays(localDateTimeParts({ now, timeZone }).date, 1);
}

export function clockToMinuteOfDay(value, label = "time") {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))) {
    throw new Error(`${label} must use HH:MM`);
  }
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

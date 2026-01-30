const { DateTime } = require("luxon");

const EVENT_IN = "IN";
const EVENT_OUT = "OUT";

const isIn = (event) => event.type === EVENT_IN;
const isOut = (event) => event.type === EVENT_OUT;

const parseTimestamp = (timestamp) => DateTime.fromISO(timestamp, { zone: "utc" });

const compareEvents = (a, b) => {
  const timeA = parseTimestamp(a.timestamp).toMillis();
  const timeB = parseTimestamp(b.timestamp).toMillis();
  return timeA - timeB;
};

const groupByUser = (events) =>
  events.reduce((accumulator, event) => {
    if (!accumulator[event.userId]) {
      accumulator[event.userId] = [];
    }
    accumulator[event.userId].push(event);
    return accumulator;
  }, {});

const deriveShiftsForUser = (events) => {
  const shifts = [];
  const invalidEvents = [];
  const sorted = [...events].sort(compareEvents);
  let openShift = null;

  sorted.forEach((event) => {
    if (isIn(event)) {
      if (openShift) {
        invalidEvents.push({
          ...event,
          reason: "IN event encountered before previous shift closed",
        });
        return;
      }

      openShift = {
        userId: event.userId,
        userName: event.userName,
        start: event.timestamp,
        end: null,
        durationMinutes: null,
        inNote: event.note || "",
        outNote: "",
        openShift: true,
      };
      return;
    }

    if (isOut(event)) {
      if (!openShift) {
        invalidEvents.push({
          ...event,
          reason: "OUT event encountered without a matching IN",
        });
        return;
      }

      const startTime = parseTimestamp(openShift.start);
      const endTime = parseTimestamp(event.timestamp);
      const durationMinutes = Math.round(endTime.diff(startTime, "minutes").minutes);

      shifts.push({
        ...openShift,
        end: event.timestamp,
        durationMinutes,
        outNote: event.note || "",
        openShift: false,
      });
      openShift = null;
    }
  });

  if (openShift) {
    shifts.push(openShift);
  }

  return { shifts, invalidEvents };
};

const deriveShifts = (punchEvents) => {
  const grouped = groupByUser(punchEvents);
  const shifts = [];
  const invalidEvents = [];

  Object.values(grouped).forEach((events) => {
    const { shifts: userShifts, invalidEvents: userInvalid } = deriveShiftsForUser(events);
    shifts.push(...userShifts);
    invalidEvents.push(...userInvalid);
  });

  return { shifts, invalidEvents };
};

module.exports = {
  deriveShifts,
};

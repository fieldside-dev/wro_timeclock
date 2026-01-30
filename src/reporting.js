const { DateTime } = require("luxon");
const { deriveShifts } = require("./shiftDerivation");

const TORONTO_TZ = "America/Toronto";

const formatDateTime = (timestamp) => {
  if (!timestamp) {
    return "";
  }
  return DateTime.fromISO(timestamp, { zone: "utc" }).setZone(TORONTO_TZ).toFormat("yyyy-LL-dd HH:mm");
};

const formatDurationHours = (minutes) => {
  if (minutes === null || minutes === undefined) {
    return "";
  }
  const hours = minutes / 60;
  return Number(hours.toFixed(2));
};

const calculateCumulativeMinutes = (shifts) =>
  shifts.reduce((total, shift) => total + (shift.durationMinutes || 0), 0);

const buildReport = ({ punchEvents, rangeStart, rangeEnd }) => {
  const { shifts, invalidEvents } = deriveShifts(punchEvents);

  const filteredShifts = shifts.filter((shift) => {
    const start = DateTime.fromISO(shift.start, { zone: "utc" }).setZone(TORONTO_TZ);
    return start >= rangeStart && start <= rangeEnd;
  });

  const shiftsByUser = filteredShifts.reduce((accumulator, shift) => {
    if (!accumulator[shift.userId]) {
      accumulator[shift.userId] = [];
    }
    accumulator[shift.userId].push(shift);
    return accumulator;
  }, {});

  const rows = [];

  Object.values(shiftsByUser).forEach((userShifts) => {
    const cumulativeMinutes = calculateCumulativeMinutes(userShifts);
    const cumulativeHours = formatDurationHours(cumulativeMinutes);

    userShifts.forEach((shift) => {
      rows.push({
        userName: shift.userName,
        shiftStart: formatDateTime(shift.start),
        shiftEnd: formatDateTime(shift.end),
        duration: formatDurationHours(shift.durationMinutes),
        inNote: shift.inNote,
        outNote: shift.outNote,
        openShift: shift.openShift,
        cumulativeHours,
      });
    });
  });

  return {
    rows,
    invalidEvents,
  };
};

module.exports = {
  TORONTO_TZ,
  buildReport,
};

const express = require("express");
const { DateTime } = require("luxon");
const { buildReport, TORONTO_TZ } = require("./reporting");
const punchEvents = require("./data/punch_events.json");

const app = express();

const parseDateParam = (value, boundary) => {
  const date = DateTime.fromISO(value, { zone: TORONTO_TZ });
  if (!date.isValid) {
    return null;
  }
  return boundary === "end" ? date.endOf("day") : date.startOf("day");
};

const sendBadRequest = (res, message) => {
  res.status(400).json({ error: message });
};

const buildReportResponse = (req, res, format) => {
  const { start, end } = req.query;
  if (!start || !end) {
    return sendBadRequest(res, "start and end query parameters are required");
  }

  const rangeStart = parseDateParam(start, "start");
  const rangeEnd = parseDateParam(end, "end");

  if (!rangeStart || !rangeEnd) {
    return sendBadRequest(res, "start and end must be valid dates in YYYY-MM-DD format");
  }

  const { rows, invalidEvents } = buildReport({
    punchEvents,
    rangeStart,
    rangeEnd,
  });

  if (format === "csv") {
    const header = [
      "user_name",
      "shift_start",
      "shift_end",
      "duration_hours",
      "in_note",
      "out_note",
      "open_shift",
      "cumulative_hours",
    ];

    const csvRows = rows.map((row) => [
      row.userName,
      row.shiftStart,
      row.shiftEnd,
      row.duration === "" ? "" : row.duration,
      row.inNote,
      row.outNote,
      row.openShift ? "true" : "false",
      row.cumulativeHours === "" ? "" : row.cumulativeHours,
    ]);

    const csv = [header, ...csvRows]
      .map((values) =>
        values
          .map((value) => {
            const stringValue = value === null || value === undefined ? "" : String(value);
            if (stringValue.includes(",") || stringValue.includes("\"") || stringValue.includes("\n")) {
              return `"${stringValue.replace(/"/g, '""')}"`;
            }
            return stringValue;
          })
          .join(",")
      )
      .join("\n");

    res.setHeader("Content-Type", "text/csv");
    return res.status(200).send(csv);
  }

  return res.status(200).json({
    rangeStart: rangeStart.toISO(),
    rangeEnd: rangeEnd.toISO(),
    timezone: TORONTO_TZ,
    rows,
    invalidEvents,
  });
};

app.get("/api/report", (req, res) => buildReportResponse(req, res, "json"));
app.get("/api/report.csv", (req, res) => buildReportResponse(req, res, "csv"));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Timeclock reporting server running on port ${port}`);
});

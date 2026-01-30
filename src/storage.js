const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function getDataFile(dataDir) {
  const resolvedDir = dataDir || path.join(__dirname, '..', 'data');
  ensureDir(resolvedDir);
  return path.join(resolvedDir, 'punch_events.jsonl');
}

function readEvents(dataFile) {
  if (!fs.existsSync(dataFile)) {
    return [];
  }
  const contents = fs.readFileSync(dataFile, 'utf8').trim();
  if (!contents) {
    return [];
  }
  return contents
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function getStatusFromEvents(events) {
  const lastEvent = events.at(-1) || null;
  const status = lastEvent ? lastEvent.type : 'OUT';
  return { status, lastEvent };
}

function createStorage(dataDir) {
  const dataFile = getDataFile(dataDir);

  return {
    getStatus() {
      const events = readEvents(dataFile);
      return getStatusFromEvents(events);
    },
    appendEvent(event) {
      const line = `${JSON.stringify(event)}\n`;
      fs.appendFileSync(dataFile, line, 'utf8');
    },
    getEvents() {
      return readEvents(dataFile);
    },
  };
}

module.exports = {
  createStorage,
  getStatusFromEvents,
};

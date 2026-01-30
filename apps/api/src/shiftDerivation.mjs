export function deriveShifts(events) {
  const eventsByUser = new Map();

  for (const event of events) {
    if (!eventsByUser.has(event.userId)) {
      eventsByUser.set(event.userId, []);
    }
    eventsByUser.get(event.userId).push(event);
  }

  const shifts = [];
  const anomalies = [];

  for (const [userId, userEvents] of eventsByUser.entries()) {
    userEvents.sort((a, b) => a.eventTime - b.eventTime);

    let openShift = null;
    let lastEventType = null;

    for (const event of userEvents) {
      if (event.eventType === 'IN') {
        if (openShift) {
          anomalies.push({
            userId,
            userName: event.userName,
            eventTime: event.eventTime,
            eventType: event.eventType,
            reason: 'multiple_in',
            memo: event.memo || '',
          });
          shifts.push({
            userId,
            userName: openShift.userName,
            startEvent: openShift,
            endEvent: null,
            openShift: true,
          });
        }
        openShift = event;
      } else if (event.eventType === 'OUT') {
        if (!openShift) {
          anomalies.push({
            userId,
            userName: event.userName,
            eventTime: event.eventTime,
            eventType: event.eventType,
            reason: lastEventType === 'OUT' ? 'multiple_outs' : 'out_without_in',
            memo: event.memo || '',
          });
        } else {
          shifts.push({
            userId,
            userName: openShift.userName,
            startEvent: openShift,
            endEvent: event,
            openShift: false,
          });
          openShift = null;
        }
      }

      lastEventType = event.eventType;
    }

    if (openShift) {
      shifts.push({
        userId,
        userName: openShift.userName,
        startEvent: openShift,
        endEvent: null,
        openShift: true,
      });
    }
  }

  shifts.sort((a, b) => a.startEvent.eventTime - b.startEvent.eventTime);

  return { shifts, anomalies };
}

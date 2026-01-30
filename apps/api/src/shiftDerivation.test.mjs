import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveShifts } from './shiftDerivation.mjs';

test('pairs IN with next OUT and flags open shifts', () => {
  const events = [
    {
      id: '1',
      userId: 'user-1',
      userName: 'Ada',
      eventType: 'IN',
      eventTime: 1000,
      memo: 'Started',
    },
    {
      id: '2',
      userId: 'user-1',
      userName: 'Ada',
      eventType: 'OUT',
      eventTime: 2000,
      memo: 'Lunch',
    },
    {
      id: '3',
      userId: 'user-1',
      userName: 'Ada',
      eventType: 'IN',
      eventTime: 3000,
      memo: 'Back',
    },
  ];

  const { shifts, anomalies } = deriveShifts(events);

  assert.equal(anomalies.length, 0);
  assert.equal(shifts.length, 2);
  assert.equal(shifts[0].openShift, false);
  assert.equal(shifts[0].startEvent.id, '1');
  assert.equal(shifts[0].endEvent.id, '2');
  assert.equal(shifts[1].openShift, true);
  assert.equal(shifts[1].startEvent.id, '3');
  assert.equal(shifts[1].endEvent, null);
});

test('flags OUT anomalies without a matching IN', () => {
  const events = [
    {
      id: '1',
      userId: 'user-2',
      userName: 'Bea',
      eventType: 'OUT',
      eventTime: 1500,
      memo: '',
    },
    {
      id: '2',
      userId: 'user-2',
      userName: 'Bea',
      eventType: 'OUT',
      eventTime: 1600,
      memo: 'Duplicate',
    },
  ];

  const { shifts, anomalies } = deriveShifts(events);

  assert.equal(shifts.length, 0);
  assert.equal(anomalies.length, 2);
  assert.equal(anomalies[0].reason, 'out_without_in');
  assert.equal(anomalies[1].reason, 'multiple_outs');
});

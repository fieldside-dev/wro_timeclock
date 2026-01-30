const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createStorage } = require('../src/storage');

function makeApp() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'punch-test-'));
  const app = createApp({ dataDir });
  return { app, dataDir };
}

async function authToken(app) {
  const response = await request(app)
    .post('/api/auth/pin')
    .send({ pin: '1234' });
  return response.body.token;
}

describe('punch workflow rules', () => {
  beforeEach(() => {
    process.env.PUNCH_PIN = '1234';
    process.env.JWT_SECRET = 'test-secret';
  });

  test('IN then IN blocked', async () => {
    const { app } = makeApp();
    const token = await authToken(app);

    await request(app)
      .post('/api/punch')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'IN' })
      .expect(200);

    const response = await request(app)
      .post('/api/punch')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'IN' })
      .expect(409);

    expect(response.body.message).toMatch(/Already punched IN/);
  });

  test('OUT without prior IN blocked', async () => {
    const { app } = makeApp();
    const token = await authToken(app);

    const response = await request(app)
      .post('/api/punch')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'OUT' })
      .expect(409);

    expect(response.body.message).toMatch(/Cannot punch OUT without punching IN first/);
  });

  test('IN then OUT works', async () => {
    const { app } = makeApp();
    const token = await authToken(app);

    await request(app)
      .post('/api/punch')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'IN' })
      .expect(200);

    const response = await request(app)
      .post('/api/punch')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'OUT' })
      .expect(200);

    expect(response.body.status).toBe('OUT');
  });

  test('notes saved for both IN and OUT', async () => {
    const { app, dataDir } = makeApp();
    const token = await authToken(app);

    await request(app)
      .post('/api/punch')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'IN', note: 'Starting shift' })
      .expect(200);

    await request(app)
      .post('/api/punch')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'OUT', note: 'Lunch break' })
      .expect(200);

    const storage = createStorage(dataDir);
    const events = storage.getEvents();

    expect(events[0].note).toBe('Starting shift');
    expect(events[1].note).toBe('Lunch break');
  });
});

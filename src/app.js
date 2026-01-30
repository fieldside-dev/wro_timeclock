const express = require('express');
const jwt = require('jsonwebtoken');
const path = require('path');
const { createStorage } = require('./storage');

function createApp({ dataDir } = {}) {
  const app = express();
  const pin = process.env.PUNCH_PIN || '1234';
  const jwtSecret = process.env.JWT_SECRET || 'dev-secret';
  const tokenTtlSeconds = Number(process.env.TOKEN_TTL_SECONDS || 300);
  const storage = createStorage(dataDir);

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.post('/api/auth/pin', (req, res) => {
    const { pin: submittedPin } = req.body || {};
    if (!submittedPin || submittedPin !== pin) {
      return res.status(401).json({ message: 'Invalid PIN.' });
    }

    const token = jwt.sign({ sub: 'timeclock-user' }, jwtSecret, {
      expiresIn: tokenTtlSeconds,
    });

    return res.json({ token, expiresInSeconds: tokenTtlSeconds });
  });

  app.use('/api', (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : null;

    if (!token) {
      return res.status(401).json({ message: 'Missing token.' });
    }

    try {
      const payload = jwt.verify(token, jwtSecret);
      req.user = payload;
      return next();
    } catch (error) {
      return res.status(401).json({ message: 'Invalid or expired token.' });
    }
  });

  app.get('/api/status', (req, res) => {
    const { status, lastEvent } = storage.getStatus();
    return res.json({ status, lastEvent });
  });

  app.post('/api/punch', (req, res) => {
    const { type, note } = req.body || {};
    if (!['IN', 'OUT'].includes(type)) {
      return res.status(400).json({ message: 'Punch type must be IN or OUT.' });
    }

    const { status, lastEvent } = storage.getStatus();

    if (status === 'IN' && type === 'IN') {
      return res.status(409).json({ message: 'Already punched IN.' });
    }

    if (status === 'OUT' && type === 'OUT') {
      const detail = lastEvent
        ? 'Already punched OUT.'
        : 'Cannot punch OUT without punching IN first.';
      return res.status(409).json({ message: detail });
    }

    const event = {
      type,
      note: note ? String(note) : '',
      at: new Date().toISOString(),
    };

    storage.appendEvent(event);

    return res.json({ event, status: type });
  });

  return app;
}

module.exports = { createApp };

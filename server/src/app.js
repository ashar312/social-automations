'use strict';
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const env = require('./config/env');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { router: mediaRouter, publicRouter } = require('./routes/media');

const app = express();

// Requests that arrive through the public tunnel (Host = PUBLIC_BASE_URL host) may only reach /media/*
if (env.PUBLIC_BASE_URL) {
  const publicHost = new URL(env.PUBLIC_BASE_URL).host;
  app.use((req, res, next) => {
    if (req.headers.host === publicHost && !req.path.startsWith('/media/')) return res.status(404).end();
    next();
  });
}
app.use('/media', publicRouter);

app.use(cors({ origin: env.CLIENT_URL }));
app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' }));

app.use('/api/health', require('./routes/health'));
app.use('/api/oauth', require('./routes/oauth'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/connections', require('./routes/connections').global);
app.use('/api/media', mediaRouter);
app.use('/api/posts', require('./routes/posts'));
app.get('/api/config', (req, res) => res.json({ ok: true, youtubeAudited: env.YOUTUBE_AUDITED, publicUrlConfigured: !!env.PUBLIC_BASE_URL, rules: require('./platforms/rules').RULES }));

app.use(notFound);
app.use(errorHandler);
module.exports = app;

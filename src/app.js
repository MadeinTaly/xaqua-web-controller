'use strict';
require('dotenv').config();

const express = require('express');
const path = require('path');
const xaquaClient = require('./services/xaquaClient');
const configStore = require('./services/configStore');
const { startAcclimation } = require('./services/scheduler');
const wledScheduler = require('./services/wledScheduler');
const healthMonitor = require('./services/healthMonitor');

const app = express();
const PORT = process.env.PORT || 3000;

const config = configStore.load();
xaquaClient.setConfig(
  config.device.ip      || process.env.DEVICE_IP       || '192.168.1.1',
  process.env.DEVICE_USERNAME || config.device.username || 'Admin',
  process.env.DEVICE_PASSWORD || config.device.password || 'Admin'
);
xaquaClient.setPowerScale(config.powerScale || 100);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));
app.use('/api', require('./routes/api'));
app.use('/api/wled', require('./routes/wled').router);
app.use('/api/oscilloscope', require('./routes/oscilloscope'));
app.use('/', require('./routes/pages'));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`Xaqua Web Controller avviato su http://localhost:${PORT}`);
  startAcclimation();
  wledScheduler.start();
  if (process.env.NODE_ENV !== 'test') {
    healthMonitor.start();
  }
});

module.exports = app;

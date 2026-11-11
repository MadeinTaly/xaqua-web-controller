'use strict';

const express = require('express');
const router = express.Router();
const log = require('../../services/logger');

// API request logger
router.use((req, res, next) => {
  if (req.method === 'GET' && (req.path === '/status' || req.path === '/notifications')) return next();
  log.info('api', `${req.method} ${req.path}`, req.body && Object.keys(req.body).length ? req.body : undefined);
  next();
});

router.use(require('./device'));
router.use(require('./schedule'));
router.use(require('./nature'));
router.use(require('./experimental'));

module.exports = router;

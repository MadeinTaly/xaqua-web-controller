'use strict';

const notifications = [];
const MAX_NOTIFICATIONS = 50;

function addNotification(level, message, details = null) {
  const notification = {
    id: Date.now() + Math.random(),
    level,
    message,
    details,
    timestamp: new Date().toISOString()
  };

  notifications.unshift(notification);
  if (notifications.length > MAX_NOTIFICATIONS) {
    notifications.pop();
  }

  console.log(`[${level.toUpperCase()}] ${message}`, details || '');

  return notification;
}

function getNotifications(since = null) {
  if (!since) return [...notifications];
  return notifications.filter(n => new Date(n.timestamp) > new Date(since));
}

function clearNotifications() {
  notifications.length = 0;
}

module.exports = { addNotification, getNotifications, clearNotifications };
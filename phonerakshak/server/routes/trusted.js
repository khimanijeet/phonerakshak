const express = require('express');
const db = require('../db');

const router = express.Router();

function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return min + ' min ago';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + ' hr ago';
  return Math.floor(hr / 24) + ' day ago';
}

router.get('/:token/live', (req, res) => {
  const contact = db.getTrustedContactByToken(req.params.token);
  if (!contact) return res.status(404).json({ ok: false, error: 'invalid-token' });
  const status = db.computeLiveStatus(contact.ownerPhone);
  res.set('Cache-Control', 'no-store');
  res.json(status);
});

router.get('/:token', (req, res) => {
  const contact = db.getTrustedContactByToken(req.params.token);
  if (!contact) {
    return res
      .status(404)
      .render('trusted/invalid', { reason: 'This share link is invalid or has been revoked.' });
  }
  const owner = db.getCustomerByPhone(contact.ownerPhone);
  const device = db.getCustomerPrimaryDevice(contact.ownerPhone);
  const latest = device ? db.getLatestLocation(device.deviceId) : null;
  const photos = device ? db.getIntruderPhotos(device.deviceId, 4) : [];
  const notifications = db.listNotificationsForContact(contact.id, 10);
  db.markNotificationsViewed(contact.id);
  res.render('trusted/view', {
    contact,
    owner,
    device,
    latest,
    photos,
    notifications,
    timeAgo,
    isOnline: device ? db.isOnline(device) : false,
    protection: device ? db.getModeInfo(device) : null,
  });
});

module.exports = router;

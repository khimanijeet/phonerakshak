const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
const customerRoutes = require('./routes/customer');
const trustedRoutes = require('./routes/trusted');
const db = require('./db');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 5000;

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ENV_PASSWORD_HASH = bcrypt.hashSync(ADMIN_PASSWORD, 10);
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

function getActivePasswordHash() {
  const stored = db.getAdminAuth();
  if (stored && stored.passwordHash) return stored.passwordHash;
  return ENV_PASSWORD_HASH;
}

function verifyPassword(plain) {
  if (!plain) return false;
  try {
    return bcrypt.compareSync(plain, getActivePasswordHash());
  } catch (e) {
    return false;
  }
}

function getResetToken() {
  return (process.env.ADMIN_RESET_TOKEN || '').trim();
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function constantTimeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function isStrongEnough(password) {
  return typeof password === 'string' && password.length >= 8;
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    next();
  });
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 1000 * 60 * 60 * 12,
    },
  })
);

// API for the Android app (no auth — uses deviceId).
app.use('/api', apiRoutes);

// Auth pages
app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/admin');
  res.render('login', { resetEnabled: !!getResetToken() });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USERNAME && verifyPassword(password)) {
    req.session.user = { username };
    return res.redirect('/admin');
  }
  res.status(401).render('login', {
    error: 'Invalid username or password.',
    resetEnabled: !!getResetToken(),
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ----- Forgot / reset password (recovery via ADMIN_RESET_TOKEN secret) -----
app.get('/forgot-password', (req, res) => {
  res.render('forgot-password', {
    resetEnabled: !!getResetToken(),
    error: null,
    notice: null,
    username: '',
  });
});

app.post('/forgot-password', (req, res) => {
  const expected = getResetToken();
  if (!expected) {
    return res.status(403).render('forgot-password', {
      resetEnabled: false,
      error:
        'Password reset is disabled. Set the ADMIN_RESET_TOKEN secret in Replit, restart the app, then try again.',
      notice: null,
      username: req.body?.username || '',
    });
  }
  const { username, token, newPassword, confirmPassword } = req.body || {};
  if (!username || !token || !newPassword || !confirmPassword) {
    return res.status(400).render('forgot-password', {
      resetEnabled: true,
      error: 'All fields are required.',
      notice: null,
      username: username || '',
    });
  }
  if (username !== ADMIN_USERNAME) {
    return res.status(401).render('forgot-password', {
      resetEnabled: true,
      error: 'Invalid username or reset token.',
      notice: null,
      username,
    });
  }
  if (!constantTimeEqual(token.trim(), expected)) {
    return res.status(401).render('forgot-password', {
      resetEnabled: true,
      error: 'Invalid username or reset token.',
      notice: null,
      username,
    });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).render('forgot-password', {
      resetEnabled: true,
      error: 'New password and confirmation do not match.',
      notice: null,
      username,
    });
  }
  if (!isStrongEnough(newPassword)) {
    return res.status(400).render('forgot-password', {
      resetEnabled: true,
      error: 'New password must be at least 8 characters long.',
      notice: null,
      username,
    });
  }
  const passwordHash = bcrypt.hashSync(newPassword, 10);
  db.setAdminAuth({ passwordHash });
  db.markResetTokenUsed(hashToken(expected));
  console.log(
    'Admin password was reset via /forgot-password. Rotate ADMIN_RESET_TOKEN now.'
  );
  res.render('login', {
    resetEnabled: !!getResetToken(),
    notice:
      'Password reset successful. Sign in with your new password, then rotate ADMIN_RESET_TOKEN.',
  });
});

// ----- Change password (logged in) -----
function requireAuthPage(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login');
}

app.get('/admin/account', requireAuthPage, (req, res) => {
  res.render('account', {
    user: req.session.user,
    error: null,
    notice: null,
  });
});

app.post('/admin/account/change-password', requireAuthPage, (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body || {};
  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).render('account', {
      user: req.session.user,
      error: 'All fields are required.',
      notice: null,
    });
  }
  if (!verifyPassword(currentPassword)) {
    return res.status(401).render('account', {
      user: req.session.user,
      error: 'Current password is incorrect.',
      notice: null,
    });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).render('account', {
      user: req.session.user,
      error: 'New password and confirmation do not match.',
      notice: null,
    });
  }
  if (!isStrongEnough(newPassword)) {
    return res.status(400).render('account', {
      user: req.session.user,
      error: 'New password must be at least 8 characters long.',
      notice: null,
    });
  }
  if (currentPassword === newPassword) {
    return res.status(400).render('account', {
      user: req.session.user,
      error: 'New password must be different from the current password.',
      notice: null,
    });
  }
  const passwordHash = bcrypt.hashSync(newPassword, 10);
  db.setAdminAuth({ passwordHash });
  db.clearAdminResetState();
  res.render('account', {
    user: req.session.user,
    error: null,
    notice: 'Password updated successfully.',
  });
});

// Admin panel
app.use('/admin', adminRoutes);

// Customer portal
app.use('/customer', customerRoutes);

// Public trusted-contact share links (no login)
app.use('/trusted', trustedRoutes);

// Root: redirect to admin (or login).
app.get('/', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/admin');
  if (req.session && req.session.customer) return res.redirect('/customer');
  res.redirect('/login');
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

// Dev-only auto-login for canvas previews. Disabled in production.
app.get('/__preview-login', (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).send('Not found');
  req.session.user = { username: ADMIN_USERNAME };
  const next = typeof req.query.next === 'string' && req.query.next.startsWith('/')
    ? req.query.next
    : '/admin';
  res.redirect(next);
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).send('Internal server error');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`PhoneRakshak admin running on http://0.0.0.0:${PORT}`);
  console.log(`Login: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`);
});

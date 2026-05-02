require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const qrcode = require('qrcode');
const os = require('os');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const connectDB = require('./src/config/db');
const SecurityLog = require('./src/models/SecurityLog');
const logger = require('./src/utils/logger');
const errorHandler = require('./src/middlewares/errorHandler');

const apiRoutes = require('./src/routes/api');
const adminRoutes = require('./src/routes/admin');

// Initialize Express and Connect to DB
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, { cors: { origin: '*' } });
app.set('io', io);

connectDB();

const PORT = parseInt(process.env.PORT, 10) || 5000;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_PASSWORD_HASH = bcrypt.hashSync(ADMIN_PASSWORD, 10);
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Use morgan for HTTP request logging, piped to winston
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
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

// Rate Limiting for API routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Limit each IP to 200 requests per windowMs
  handler: (req, res, next, options) => {
    SecurityLog.create({ ip: req.ip, type: 'API Spam', message: 'Rate limit exceeded on API routes' }).catch(err => console.error(err));
    res.status(options.statusCode).send(options.message);
  }
});

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // Limit each IP to 20 auth requests per hour
  handler: (req, res, next, options) => {
    SecurityLog.create({ ip: req.ip, type: 'Brute Force', message: 'Rate limit exceeded on Auth routes' }).catch(err => console.error(err));
    res.status(options.statusCode).send(options.message);
  }
});

app.use('/api/devices', authLimiter);
app.use('/api', apiLimiter, apiRoutes);

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

app.get('/install', async (req, res, next) => {
  try {
    let host = req.get('host');
    if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
      const port = host.split(':')[1] || PORT;
      host = `${getLocalIp()}:${port}`;
    }
    const installUrl = `${req.protocol}://${host}/download/PhoneRakshak.apk`;
    
    const qrDataUrl = await qrcode.toDataURL(installUrl, {
      errorCorrectionLevel: 'H', margin: 2, width: 300,
      color: { dark: '#000000', light: '#ffffff' }
    });
    
    res.render('install', { qrDataUrl, installUrl });
  } catch (err) { next(err); }
});

app.get('/admin-qr', async (req, res, next) => {
  try {
    let host = req.get('host');
    if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
      const port = host.split(':')[1] || PORT;
      host = `${getLocalIp()}:${port}`;
    }
    const adminUrl = `${req.protocol}://${host}/download/PhoneRakshak.apk`;
    
    const qrDataUrl = await qrcode.toDataURL(adminUrl, {
      errorCorrectionLevel: 'H', margin: 2, width: 300,
      color: { dark: '#000000', light: '#ffffff' }
    });
    
    res.render('admin-qr', { qrDataUrl, adminUrl });
  } catch (err) { next(err); }
});

app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/admin');
  res.render('login', {});
});

app.post('/login', async (req, res) => {
  const { username, password, token } = req.body || {};
  if (username === ADMIN_USERNAME && bcrypt.compareSync(password || '', ADMIN_PASSWORD_HASH)) {
    
    // Check if 2FA is enabled
    const Config = require('./src/models/Config');
    const speakeasy = require('speakeasy');
    const config = await Config.findOne({ key: 'admin_2fa_secret' });
    
    if (config) {
      if (!token) {
        return res.status(401).render('login', { error: 'Authenticator code is required.' });
      }
      const verified = speakeasy.totp.verify({
        secret: config.value,
        encoding: 'base32',
        token: token,
        window: 1
      });
      if (!verified) {
        SecurityLog.create({ ip: req.ip, type: 'Failed Login', message: `Invalid 2FA code for user: ${username}` }).catch(err => console.error(err));
        return res.status(401).render('login', { error: 'Invalid authenticator code.' });
      }
    }
    
    req.session.user = { username };
    return res.redirect('/admin');
  }
  SecurityLog.create({ ip: req.ip, type: 'Failed Login', message: `Invalid attempt for user: ${username || 'unknown'}` }).catch(err => console.error(err));
  res.status(401).render('login', { error: 'Invalid username or password.' });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.use('/admin', adminRoutes);

app.get('/', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/admin');
  res.redirect('/login');
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

// Custom centralized error handler
app.use(errorHandler);

server.listen(PORT, '0.0.0.0', () => {
  logger.info(`PhoneRakshak admin running on http://0.0.0.0:${PORT}`);
  logger.info(`Login: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`);
});

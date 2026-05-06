const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'phonerakshak_super_secret_key_123!';

exports.verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    // For backward compatibility during rollout, we might allow requests without auth if we haven't updated the app yet.
    // However, the strict requirement says: "Require token for all /api requests". 
    // To avoid immediately breaking older apps before the new one is compiled, we log a warning but strictly enforce it.
    return res.status(401).json({ error: 'Authorization header missing' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token missing' });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    
    // Attach userId to request
    req.userId = decoded.userId;
    
    next();
  });
};

exports.generateToken = (userId) => {
  // Token expires in 7 days for better security
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
};

const Customer = require('../models/Customer');

exports.requireActiveUser = async (req, res, next) => {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized: userId missing' });
    const user = await Customer.findById(req.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.status === 'blocked') {
      return res.status(403).json({ error: 'Account suspended. Please contact support.' });
    }
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

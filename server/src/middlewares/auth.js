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
    
    // Attach deviceId to request
    req.deviceId = decoded.deviceId;
    
    // Ensure the deviceId in the body/params matches the token for security
    const requestedDeviceId = req.body.deviceId || req.params.id || req.body.id;
    if (requestedDeviceId && requestedDeviceId !== req.deviceId) {
      return res.status(403).json({ error: 'Token does not match requested deviceId' });
    }
    
    next();
  });
};

exports.generateToken = (deviceId) => {
  // Token expires in 7 days for better security
  return jwt.sign({ deviceId }, JWT_SECRET, { expiresIn: '7d' });
};

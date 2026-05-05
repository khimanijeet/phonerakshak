const express = require('express');
const router = express.Router();

// Block all customer web routes
router.all('*', (req, res) => {
  res.send(`
    <div style="display: flex; height: 100vh; align-items: center; justify-content: center; font-family: sans-serif; background: #121212; color: #fff; text-align: center; padding: 20px;">
      <div>
        <h2 style="color: #ff4b4b;">Access Restricted</h2>
        <p>Customer access is available only via the PhoneRakshak mobile app.</p>
      </div>
    </div>
  `);
});

module.exports = router;

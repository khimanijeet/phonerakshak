const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const Customer = require('./src/models/Customer');
  const result = await Customer.updateOne({ phone: '9811000222' }, { $set: { isPremium: true } });
  console.log('Demo user upgraded to premium! Result:', result);
  process.exit(0);
}).catch(console.error);

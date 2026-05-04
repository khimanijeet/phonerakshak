const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  text: { type: String, required: true },
  isBot: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now }
});

const supportTicketSchema = new mongoose.Schema({
  phone: { type: String, required: true, index: true },
  messages: [messageSchema],
  priority: { type: String, enum: ['normal', 'high'], default: 'normal' },
  status: { type: String, enum: ['open', 'escalated', 'closed'], default: 'open' },
  botResponseCount: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);

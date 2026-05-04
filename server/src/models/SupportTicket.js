const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  text: { type: String, required: true },
  isBot: { type: Boolean, default: false },
  sender: { type: String, enum: ['user', 'admin', 'bot'], default: 'user' },
  timestamp: { type: Date, default: Date.now }
});

const supportTicketSchema = new mongoose.Schema({
  phone: { type: String, required: true, index: true },
  issueType: { type: String, enum: ['lost_phone', 'technical', 'general', 'unknown'], default: 'unknown' },
  messages: [messageSchema],
  priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
  status: { type: String, enum: ['open', 'in_progress', 'resolved', 'closed'], default: 'open' },
  botResponseCount: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);

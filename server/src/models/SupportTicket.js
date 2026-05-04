const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  text: { type: String, required: true },
  isBot: { type: Boolean, default: false },
  sender: { type: String, enum: ['user', 'admin', 'bot'], default: 'user' },
  type: { type: String, enum: ['text', 'system'], default: 'text' },
  timestamp: { type: Date, default: Date.now }
});

const supportTicketSchema = new mongoose.Schema({
  phone: { type: String, required: true, index: true },
  issueType: { type: String, enum: ['lost_phone', 'technical', 'general', 'unknown'], default: 'unknown' },
  messages: [messageSchema],
  priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
  status: { type: String, enum: ['bot_active', 'human_assigned', 'open', 'in_progress', 'resolved', 'closed'], default: 'bot_active' },
  botResponseCount: { type: Number, default: 0 },
  botHandled: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);

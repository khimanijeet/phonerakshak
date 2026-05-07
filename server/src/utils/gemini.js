const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('./logger');

let genAI = null;

function getGenAI() {
  if (genAI) return genAI;
  if (!process.env.GEMINI_API_KEY) {
    logger.warn('GEMINI_API_KEY is not set in environment variables. AI responses will fail.');
    return null;
  }
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return genAI;
}

/**
 * Optimizes the conversation context based on length.
 */
function optimizeContext(messages) {
  // Filter out system messages or irrelevant logs
  const validMessages = messages.filter(m => m.type === 'text' && m.sender !== 'system');
  
  // Dynamic sizing based on string length
  let contextSize = 5;
  const avgLength = validMessages.reduce((sum, m) => sum + (m.text ? m.text.length : 0), 0) / (validMessages.length || 1);
  
  if (avgLength < 50) {
    contextSize = 10; // short messages, can include more context
  }

  const recentMessages = validMessages.slice(-contextSize).map(m => {
    // Sanitize or trim extreme lengths
    const text = m.text.length > 500 ? m.text.substring(0, 500) + '...' : m.text;
    return `${m.sender.toUpperCase()}: ${text}`;
  });

  return recentMessages;
}

/**
 * Generate AI Response using Gemini
 */
async function generateSupportResponse(ticket, customerContext) {
  try {
    const ai = getGenAI();
    if (!ai) throw new Error('Gemini API not configured');

    const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });

    const recentConversation = optimizeContext(ticket.messages);
    
    // Construct System Prompt
    const systemPrompt = `You are the PhoneRakshak AI Security Assistant.
Your role is to help users secure their devices, locate missing phones, and manage alarms.
You are professional, concise, and helpful.

SAFETY RULES:
1. You CANNOT execute commands directly. You can only SUGGEST the user click the "Lock", "Locate", or "Alarm" buttons in their dashboard.
2. If the user is in severe distress (e.g., phone stolen, being followed, physical danger) or uses words like "urgent", you MUST include the exact keyword [ESCALATE] somewhere in your response. This will trigger an automatic transfer to a human agent.
3. Keep responses under 3 sentences for readability.
4. Do NOT ask for passwords, PINs, or sensitive information.

CONTEXT:
Ticket Priority: ${ticket.priority || 'normal'}
Issue Type: ${ticket.issueType || 'general'}
Premium User: ${['plus', 'premium'].includes(customerContext.plan) ? 'Yes (' + customerContext.plan + ')' : 'No'}
Device Status: ${customerContext.devices && customerContext.devices.length > 0 ? (customerContext.devices[0].online ? 'Online' : 'Offline') : 'No Linked Device'}

CONVERSATION HISTORY:
${recentConversation.join('\n')}

BOT:`;

    // Log the sanitized prompt (exclude the literal message text if highly sensitive, but for now we log the length or a safe summary)
    logger.info(`[GEMINI] Generating response for ticket ${ticket._id}. Context size: ${recentConversation.length} messages.`);

    const result = await model.generateContent(systemPrompt);
    const response = await result.response;
    const text = response.text();

    logger.info(`[GEMINI] Response received (Length: ${text.length}).`);
    return text.trim();

  } catch (err) {
    logger.error(`[GEMINI ERROR] ${err.message}`);
    return "Our support team will assist you shortly."; // Fallback response
  }
}

module.exports = {
  generateSupportResponse
};

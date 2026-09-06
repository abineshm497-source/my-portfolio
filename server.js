const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Determine static asset directory (my-portfolio-main subfolder or current directory)
const staticDir = fs.existsSync(path.join(__dirname, 'index.html'))
  ? __dirname
  : path.join(__dirname, 'my-portfolio-main');

const dataDir = path.join(staticDir, 'data');
const messagesFilePath = path.join(dataDir, 'messages.json');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

if (!fs.existsSync(messagesFilePath)) {
  fs.writeFileSync(messagesFilePath, JSON.stringify([], null, 2), 'utf8');
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files (index.html, profile.jpg, etc.)
app.use(express.static(staticDir));
app.use(express.static(__dirname));
if (fs.existsSync(path.join(__dirname, 'my-portfolio-main'))) {
  app.use(express.static(path.join(__dirname, 'my-portfolio-main')));
}

// Rate Limiter for Contact API (Max 5 submissions per 15 minutes per IP)
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    error: 'Too many contact requests from this IP. Please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Helper: Save message to local JSON database
function saveMessageToDb(messageData) {
  try {
    const rawData = fs.readFileSync(messagesFilePath, 'utf8');
    const messages = JSON.parse(rawData || '[]');
    messages.push(messageData);
    fs.writeFileSync(messagesFilePath, JSON.stringify(messages, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing to message database:', err);
    return false;
  }
}

// Helper: Send Email via Nodemailer
async function sendNotificationEmails(name, email, reason) {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpUser || !smtpPass || smtpPass === 'your_app_password_here') {
    console.log('⚠️ [Nodemailer] SMTP credentials not set in .env. Message saved to database only.');
    return { sent: false, reason: 'SMTP credentials not configured in .env' };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  });

  const receiverEmail = process.env.RECEIVER_EMAIL || 'abineshm497@gmail.com';

  // 1. Alert email to portfolio owner
  const mailToOwner = {
    from: `"Portfolio Contact Form" <${smtpUser}>`,
    to: receiverEmail,
    replyTo: email,
    subject: `New Portfolio Message from ${name}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px; color: #1a1a2e;">
        <h2 style="color: #1d4ed8; margin-top: 0;">New Inquiry Received</h2>
        <p><strong>Sender Name:</strong> ${name}</p>
        <p><strong>Email Address:</strong> <a href="mailto:${email}">${email}</a></p>
        <p><strong>Reason / Message:</strong></p>
        <div style="background-color: #f8f9fc; border-left: 4px solid #1d4ed8; padding: 16px; margin: 16px 0; white-space: pre-wrap;">${reason}</div>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin-top: 24px;">
        <p style="font-size: 0.85rem; color: #64748b;">Sent via Abinesh M Portfolio Backend Service.</p>
      </div>
    `
  };

  // 2. Auto-reply email to the sender
  const mailToSender = {
    from: `"Abinesh M" <${smtpUser}>`,
    to: email,
    subject: `Thank you for contacting me, ${name}!`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px; color: #1a1a2e;">
        <h2 style="color: #1d4ed8; margin-top: 0;">Thank You for Reaching Out!</h2>
        <p>Hi ${name},</p>
        <p>Thank you for visiting my portfolio and submitting a message. I have received your note regarding:</p>
        <blockquote style="background-color: #f8f9fc; border-left: 4px solid #0f766e; padding: 12px; font-style: italic;">"${reason}"</blockquote>
        <p>I will review your message and reply as soon as possible.</p>
        <br>
        <p>Best regards,</p>
        <p><strong>Abinesh M</strong><br>Electrical & Electronics Engineer<br><a href="https://github.com/abinesh-m">GitHub Profile</a></p>
      </div>
    `
  };

  await transporter.sendMail(mailToOwner);
  await transporter.sendMail(mailToSender);
  return { sent: true };
}

// API Routes

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Contact Form Endpoint
app.post('/api/contact', contactLimiter, async (req, res) => {
  try {
    const { name, email, reason } = req.body;

    // Server-side validation
    if (!name || !email || !reason) {
      return res.status(400).json({
        success: false,
        error: 'Please fill in all required fields (name, email, reason).'
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid email address.'
      });
    }

    const messageRecord = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      timestamp: new Date().toISOString(),
      ip: req.ip || req.headers['x-forwarded-for'] || 'unknown',
      name: name.trim(),
      email: email.trim(),
      reason: reason.trim()
    };

    // Save to local database
    const saved = saveMessageToDb(messageRecord);

    // Attempt sending email
    let emailStatus = { sent: false };
    try {
      emailStatus = await sendNotificationEmails(messageRecord.name, messageRecord.email, messageRecord.reason);
    } catch (emailErr) {
      console.error('Error sending emails via Nodemailer:', emailErr.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Your message has been received successfully!',
      dbSaved: saved,
      emailSent: emailStatus.sent
    });
  } catch (err) {
    console.error('Contact API Error:', err);
    return res.status(500).json({
      success: false,
      error: 'An internal server error occurred. Please try again later.'
    });
  }
});

// Admin / Review route to inspect stored messages
app.get('/api/messages', (req, res) => {
  try {
    const rawData = fs.readFileSync(messagesFilePath, 'utf8');
    const messages = JSON.parse(rawData || '[]');
    res.json({ success: true, count: messages.length, messages });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to retrieve messages.' });
  }
});

// Fallback route for SPA / index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`🚀 Portfolio Backend Server active on port ${PORT}`);
  console.log(`🌐 Local URL: http://localhost:${PORT}`);
  console.log(`✉️  Contact API: http://localhost:${PORT}/api/contact`);
  console.log(`📊 Message DB: ${messagesFilePath}`);
  console.log(`==================================================`);
});

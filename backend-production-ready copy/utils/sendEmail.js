const nodemailer = require('nodemailer');

const APP_NAME = process.env.APP_NAME || 'Manazel';
const FROM_EMAIL = process.env.EMAIL_FROM || process.env.EMAIL_USER;

let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error('EMAIL_USER and EMAIL_PASS must be set');
  }

  const smtpConfig = {
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT, 10) || 465,
    secure: process.env.EMAIL_SECURE !== 'false',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  };

  transporter = nodemailer.createTransport(smtpConfig);
  return transporter;
};

const sendEmail = async (to, subject, text, options = {}) => {
  if (!to || !subject) throw new Error('Recipient and subject are required');

  const mailOptions = {
    from: `"${APP_NAME}" <${FROM_EMAIL}>`,
    to,
    subject,
    text,
    ...options,
  };

  try {
    const result = await getTransporter().sendMail(mailOptions);
    console.log(`Email sent to ${to}`);
    return result;
  } catch (error) {
    console.error(`Email failed to ${to}:`, error.message);
    console.error(`SMTP Error Code: ${error.code || 'N/A'}, Command: ${error.command || 'N/A'}`);
    console.error(`Response: ${error.response || 'N/A'}`);
    throw new Error('Failed to send email');
  }
};

module.exports = sendEmail;

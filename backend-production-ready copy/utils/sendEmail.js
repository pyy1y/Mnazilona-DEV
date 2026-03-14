const nodemailer = require('nodemailer');

const APP_NAME = process.env.APP_NAME || 'Manazel';
const FROM_EMAIL = process.env.EMAIL_FROM || process.env.EMAIL_USER;

let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error('EMAIL_USER and EMAIL_PASS must be set');
  }
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
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
    throw new Error('Failed to send email');
  }
};

module.exports = sendEmail;

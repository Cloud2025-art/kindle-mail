// Import only SMTP, so the installed bundle never contains sendmail/child_process.
const Mailer = require("nodemailer/lib/mailer");
const SMTPTransport = require("nodemailer/lib/smtp-transport");
function createTransport(options) {
  return new Mailer(new SMTPTransport(options), options);
}
module.exports = { createTransport };

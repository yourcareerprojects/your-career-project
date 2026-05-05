# Email Configuration Guide

## Current Status
- ✅ Email functionality is working
- ✅ Emails are being sent to Ethereal Email (test service)
- ❌ Emails are NOT being delivered to real inboxes

## How to Enable Real Email Delivery

### Option 1: Gmail SMTP (Recommended for Testing)

1. **Enable 2-Factor Authentication** on your Gmail account
2. **Generate an App Password**:
   - Go to Google Account Settings
   - Security → 2-Step Verification → App passwords
   - Generate a password for "Mail"
3. **Update the email service**:

```javascript
// In src/server/services/emailService.js
const createProductionTransporter = () => {
  return nodemailer.createTransporter({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER, // your-gmail@gmail.com
      pass: process.env.EMAIL_PASS, // your app password
    },
  });
};
```

4. **Add environment variables** to your `.env` file:
```
EMAIL_USER=your-gmail@gmail.com
EMAIL_PASS=your-app-password
```

### Option 2: SendGrid (Recommended for Production)

1. **Sign up for SendGrid** (free tier available)
2. **Verify your domain** or use single sender verification
3. **Get API key** from SendGrid dashboard
4. **Update the email service**:

```javascript
// In src/server/services/emailService.js
const createProductionTransporter = () => {
  return nodemailer.createTransporter({
    host: 'smtp.sendgrid.net',
    port: 587,
    secure: false,
    auth: {
      user: 'apikey',
      pass: process.env.SENDGRID_API_KEY,
    },
  });
};
```

5. **Add environment variable**:
```
SENDGRID_API_KEY=your-sendgrid-api-key
```

### Option 3: AWS SES (Production)

1. **Set up AWS SES** in your AWS account
2. **Verify your domain** or email address
3. **Get SMTP credentials** from AWS SES
4. **Update the email service**:

```javascript
const createProductionTransporter = () => {
  return nodemailer.createTransporter({
    host: 'email-smtp.us-east-1.amazonaws.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.AWS_SES_USER,
      pass: process.env.AWS_SES_PASS,
    },
  });
};
```

## Quick Test Setup (Gmail)

1. **Create a `.env` file** in your project root:
```
EMAIL_USER=your-gmail@gmail.com
EMAIL_PASS=your-app-password
```

2. **Update the email service** to use Gmail:

```javascript
// In src/server/services/emailService.js, replace the createProductionTransporter function:
const createProductionTransporter = () => {
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    return nodemailer.createTransporter({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }
  return null;
};
```

3. **Restart your server**
4. **Test the email functionality**

## Current Test Email Preview

When you send an email, you'll see a success message like:
```
Email sent successfully! Check preview: https://ethereal.email/message/...
```

**Click the preview URL** to see exactly what email was sent.

## Next Steps

1. **For immediate testing**: Use the preview URLs to see the emails
2. **For real delivery**: Configure Gmail SMTP (easiest)
3. **For production**: Use SendGrid or AWS SES

The email functionality is working perfectly - you just need to configure a real email service to deliver to actual inboxes! 
const nodemailer = require('nodemailer');

// Create a test account for development (you can replace this with real SMTP settings)
const createTestAccount = async () => {
  try {
    const testAccount = await nodemailer.createTestAccount();
    return nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
  } catch (error) {
    console.error('Error creating test account:', error);
    return null;
  }
};

// Create transporter for production (you can configure this with your email service)
const createProductionTransporter = () => {
  // Check if Gmail credentials are provided
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }

  // For now, return null to use test account
  return null;
};

const sendShareEmail = async ({ from, to, subject, message, shareableLink }) => {
  try {
    // Try production transporter first, fallback to test account
    let transporter = createProductionTransporter();
    
    if (!transporter) {
      console.log('Using test email account for development');
      transporter = await createTestAccount();
    }

    if (!transporter) {
      throw new Error('Failed to create email transporter');
    }

    const mailOptions = {
      from: from || 'career-path-explorer@example.com',
      to: to,
      subject: subject || 'Career Opportunity Shared with You',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1c662a;">Career Opportunity Shared with You</h2>
          
          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #333;">${subject || 'Career Opportunity'}</h3>
            
            ${message ? `<p style="font-style: italic; color: #666;">"${message}"</p>` : ''}
            
            <div style="margin: 20px 0;">
              <a href="${shareableLink}" 
                 style="background-color: #1c662a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
                View Career Opportunity
              </a>
            </div>
            
            <p style="font-size: 14px; color: #666;">
              This link was shared with you from the Career Path Explorer tool. 
              The link will expire in 30 days for security purposes.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
            <p style="color: #999; font-size: 12px;">
              Career Path Explorer - Helping professionals discover their ideal career paths
            </p>
          </div>
        </div>
      `,
      text: `
Career Opportunity Shared with You

${subject || 'Career Opportunity'}

${message ? `Message: "${message}"` : ''}

View the career opportunity: ${shareableLink}

This link was shared with you from the Career Path Explorer tool. 
The link will expire in 30 days for security purposes.

---
Career Path Explorer - Helping professionals discover their ideal career paths
      `
    };

    const info = await transporter.sendMail(mailOptions);
    
    console.log('Email sent successfully:', {
      messageId: info.messageId,
      previewURL: nodemailer.getTestMessageUrl(info),
      to: to
    });

    return {
      success: true,
      messageId: info.messageId,
      previewURL: nodemailer.getTestMessageUrl(info)
    };
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
};

module.exports = {
  sendShareEmail
}; 
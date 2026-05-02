// BolsterMed - Send Survey Invitation (Email + SMS)
// Vercel Serverless Function
//
// Handles TWO flows:
//   1. HR Dashboard flow: receives surveyUrl directly (original)
//   2. Candidate Portal flow: receives candidateId, creates invitation in Supabase first
//
// Required Environment Variables (set in Vercel Dashboard → Settings → Environment Variables):
//   RESEND_API_KEY - Your Resend API key
//   TWILIO_ACCOUNT_SID - Your Twilio Account SID
//   TWILIO_AUTH_TOKEN - Your Twilio Auth Token
//   TWILIO_PHONE_NUMBER - Your Twilio phone number (e.g., +15551234567)
//   SUPABASE_URL - Your Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY - Your Supabase service role key

export default async function handler(req, res) {
    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const {
            // Shared fields
            referenceName,
            referenceEmail,
            referencePhone,
            candidateName,
            orgName,
            // HR flow fields
            surveyUrl: providedSurveyUrl,
            // Candidate portal flow fields
            candidateId,
            orgId,
            roleId,
            relationship,
        } = req.body;

        if (!referenceName || !referenceEmail) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        let surveyUrl = providedSurveyUrl;
        let invitationId = null;

        // ════════════════════════════════════════════════════════════
        // CANDIDATE PORTAL FLOW: Create invitation in Supabase first
        // ════════════════════════════════════════════════════════════
        if (candidateId && !surveyUrl) {
            if (!orgId) {
                return res.status(400).json({ error: 'Missing orgId for candidate flow' });
            }

            const SUPABASE_URL = process.env.SUPABASE_URL || 'https://apluotdtsithufnrfdhv.supabase.co';
            const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

            // Generate unique survey token
            const crypto = await import('crypto');
            const token = crypto.randomBytes(32).toString('hex');

            // Create survey invitation via Supabase REST API
            const invPayload = {
                candidate_id: candidateId,
                org_id: orgId,
                role_id: roleId || 'ed-physician',
                reference_name: referenceName,
                reference_email: referenceEmail,
                reference_phone: referencePhone || null,
                relationship: relationship || null,
                candidate_name: candidateName || null,
                token: token,
                status: 'pending',
                expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            };

            const invRes = await fetch(`${SUPABASE_URL}/rest/v1/survey_invitations`, {
                method: 'POST',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation',
                },
                body: JSON.stringify(invPayload),
            });

            if (!invRes.ok) {
                const errText = await invRes.text();
                console.error('Invitation insert error:', errText);
                return res.status(500).json({ error: 'Failed to create invitation: ' + errText });
            }

            const invitations = await invRes.json();
            const invitation = Array.isArray(invitations) ? invitations[0] : invitations;
            invitationId = invitation.id;

            // Build survey URL from token
            const baseUrl = process.env.BASE_URL || 'https://bolstermed.app';
            surveyUrl = `${baseUrl}/ref/${token}`;
        }

        if (!surveyUrl) {
            return res.status(400).json({ error: 'Missing surveyUrl' });
        }

        const results = { email: null, sms: null };
        if (invitationId) results.invitation_id = invitationId;

        // ============================================================
        // SEND EMAIL via Resend
        // ============================================================
        const RESEND_API_KEY = process.env.RESEND_API_KEY;
        if (RESEND_API_KEY) {
            try {
                const emailHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f4f1ec; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <!-- Header -->
        <div style="background-color: #0f1f35; border-radius: 12px 12px 0 0; padding: 30px; text-align: center;">
            <span style="font-family: Georgia, 'Times New Roman', serif; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">
                <span style="color: #ffffff;">Bolster</span><span style="color: #2db89a;">Med</span>
            </span>
            <p style="color: #8a97a8; font-size: 11px; text-transform: uppercase; letter-spacing: 2px; margin-top: 8px;">Reference Intelligence Platform</p>
        </div>

        <!-- Body -->
        <div style="background-color: #ffffff; padding: 40px 30px; border-radius: 0 0 12px 12px;">
            <h1 style="font-family: Georgia, 'Times New Roman', serif; color: #0f1f35; font-size: 24px; margin-bottom: 16px;">
                You've been asked to provide a reference
            </h1>

            <p style="color: #4a5568; font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
                Hi ${referenceName},
            </p>

            <p style="color: #4a5568; font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
                ${orgName || 'A healthcare organization'} has requested your professional reference for <strong>${candidateName || 'a candidate'}</strong>. Your feedback is confidential and will be used to support their hiring evaluation.
            </p>

            <p style="color: #4a5568; font-size: 16px; line-height: 1.6; margin-bottom: 32px;">
                The survey takes approximately <strong>5 minutes</strong> to complete.
            </p>

            <!-- CTA Button -->
            <div style="text-align: center; margin-bottom: 32px;">
                <a href="${surveyUrl}"
                   style="display: inline-block; background-color: #2db89a; color: #ffffff; text-decoration: none;
                          padding: 16px 48px; border-radius: 8px; font-size: 16px; font-weight: 600;
                          letter-spacing: 0.5px;">
                    Complete Reference Survey
                </a>
            </div>

            <p style="color: #8a97a8; font-size: 13px; line-height: 1.6; margin-bottom: 8px;">
                If the button above doesn't work, copy and paste this link into your browser:
            </p>
            <p style="color: #2db89a; font-size: 13px; word-break: break-all; margin-bottom: 24px;">
                ${surveyUrl}
            </p>

            <hr style="border: none; border-top: 1px solid #e8e4dc; margin: 24px 0;">

            <p style="color: #8a97a8; font-size: 12px; line-height: 1.5; text-align: center;">
                This is a confidential reference evaluation. Your responses will not be shared with the candidate.
                <br>This link expires in 30 days.
            </p>
        </div>

        <!-- Footer -->
        <div style="text-align: center; padding: 20px;">
            <p style="color: #8a97a8; font-size: 11px;">
                Powered by BolsterMed &mdash; Reference Intelligence for Healthcare
            </p>
        </div>
    </div>
</body>
</html>`;

                const emailRes = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${RESEND_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        from: process.env.RESEND_FROM_EMAIL || 'BolsterMed <noreply@bolstermed.app>',
                        to: [referenceEmail],
                        subject: `Reference Request for ${candidateName || 'a candidate'} - BolsterMed`,
                        html: emailHtml,
                    }),
                });

                const emailData = await emailRes.json();
                if (emailRes.ok) {
                    results.email = { success: true, id: emailData.id };
                } else {
                    results.email = { success: false, error: emailData.message || 'Email failed' };
                }
            } catch (emailErr) {
                results.email = { success: false, error: emailErr.message };
            }
        } else {
            results.email = { success: false, error: 'RESEND_API_KEY not configured' };
        }

        // ============================================================
        // SEND SMS via Twilio
        // ============================================================
        const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
        const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
        const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER;

        if (TWILIO_SID && TWILIO_TOKEN && TWILIO_PHONE && referencePhone) {
            try {
                // Format phone number - ensure it has +1 prefix for US numbers
                let formattedPhone = referencePhone.replace(/[\s\-\(\)\.]/g, '');
                if (!formattedPhone.startsWith('+')) {
                    if (formattedPhone.startsWith('1') && formattedPhone.length === 11) {
                        formattedPhone = '+' + formattedPhone;
                    } else if (formattedPhone.length === 10) {
                        formattedPhone = '+1' + formattedPhone;
                    }
                }

                const smsBody = `Hi ${referenceName}, you've been asked to provide a professional reference for ${candidateName || 'a candidate'}. It takes about 5 min. Please complete it here: ${surveyUrl} - BolsterMed`;

                const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
                const twilioAuth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');

                const smsRes = await fetch(twilioUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${twilioAuth}`,
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: new URLSearchParams({
                        To: formattedPhone,
                        From: TWILIO_PHONE,
                        Body: smsBody,
                    }).toString(),
                });

                const smsData = await smsRes.json();
                if (smsRes.ok || smsRes.status === 201) {
                    results.sms = { success: true, sid: smsData.sid };
                } else {
                    results.sms = { success: false, error: smsData.message || 'SMS failed' };
                }
            } catch (smsErr) {
                results.sms = { success: false, error: smsErr.message };
            }
        } else if (!referencePhone) {
            results.sms = { success: false, error: 'No phone number provided' };
        } else {
            results.sms = { success: false, error: 'Twilio not configured' };
        }

        // ── Update invitation status to 'sent' if this was the candidate flow ──
        if (invitationId) {
            try {
                const SUPABASE_URL = process.env.SUPABASE_URL || 'https://apluotdtsithufnrfdhv.supabase.co';
                const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
                await fetch(`${SUPABASE_URL}/rest/v1/survey_invitations?id=eq.${invitationId}`, {
                    method: 'PATCH',
                    headers: {
                        'apikey': SUPABASE_KEY,
                        'Authorization': `Bearer ${SUPABASE_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ status: 'sent' }),
                });
            } catch (patchErr) {
                console.error('Failed to update invitation status:', patchErr);
            }
        }

        // Return results
        const anySuccess = (results.email && results.email.success) || (results.sms && results.sms.success);
        return res.status(anySuccess ? 200 : 500).json(results);

    } catch (err) {
        console.error('Send invitation error:', err);
        return res.status(500).json({ error: err.message });
    }
}

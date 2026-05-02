// BolsterMed - Submit Candidate References
// Called by candidate.html when a candidate submits their reference contacts.
// Creates survey invitations and sends email + SMS notifications.
// Uses direct Supabase REST API (no npm dependency needed).

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const {
            candidateId,
            orgId,
            roleId,
            referenceName,
            referenceEmail,
            referencePhone,
            relationship,
            candidateName,
        } = req.body;

        if (!candidateId || !orgId || !referenceName || !referenceEmail) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const SUPABASE_URL = process.env.SUPABASE_URL || 'https://apluotdtsithufnrfdhv.supabase.co';
        const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        // ── 1. Generate unique survey token ──
        const crypto = await import('crypto');
        const token = crypto.randomBytes(32).toString('hex');

        // ── 2. Create survey invitation via Supabase REST API ──
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

        // ── 3. Build survey URL ──
        const baseUrl = process.env.BASE_URL || 'https://bolstermed.app';
        const surveyUrl = `${baseUrl}/ref/${token}`;

        // ── 4. Send notifications ──
        const results = { email: null, sms: null, invitation_id: invitation.id };

        // EMAIL via Resend
        const RESEND_API_KEY = process.env.RESEND_API_KEY;
        if (RESEND_API_KEY) {
            try {
                const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f1ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
        <div style="background-color:#0f1f35;border-radius:12px 12px 0 0;padding:30px;text-align:center;">
            <span style="font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:700;letter-spacing:-0.5px;">
                <span style="color:#ffffff;">Bolster</span><span style="color:#2db89a;">Med</span>
            </span>
            <p style="color:#8a97a8;font-size:11px;text-transform:uppercase;letter-spacing:2px;margin-top:8px;">Reference Intelligence Platform</p>
        </div>
        <div style="background-color:#ffffff;padding:40px 30px;border-radius:0 0 12px 12px;">
            <h1 style="font-family:Georgia,'Times New Roman',serif;color:#0f1f35;font-size:24px;margin-bottom:16px;">
                You've been asked to provide a reference
            </h1>
            <p style="color:#4a5568;font-size:16px;line-height:1.6;margin-bottom:16px;">
                Hi ${referenceName},
            </p>
            <p style="color:#4a5568;font-size:16px;line-height:1.6;margin-bottom:16px;">
                A healthcare organization has requested your professional reference for <strong>${candidateName || 'a candidate'}</strong>. Your feedback is confidential and will be used to support their hiring evaluation.
            </p>
            <p style="color:#4a5568;font-size:16px;line-height:1.6;margin-bottom:32px;">
                The survey takes approximately <strong>5 minutes</strong> to complete.
            </p>
            <div style="text-align:center;margin-bottom:32px;">
                <a href="${surveyUrl}" style="display:inline-block;background-color:#2db89a;color:#ffffff;text-decoration:none;padding:16px 48px;border-radius:8px;font-size:16px;font-weight:600;letter-spacing:0.5px;">
                    Complete Reference Survey
                </a>
            </div>
            <p style="color:#8a97a8;font-size:13px;line-height:1.6;margin-bottom:8px;">
                If the button doesn't work, copy and paste this link:
            </p>
            <p style="color:#2db89a;font-size:13px;word-break:break-all;margin-bottom:24px;">
                ${surveyUrl}
            </p>
            <hr style="border:none;border-top:1px solid #e8e4dc;margin:24px 0;">
            <p style="color:#8a97a8;font-size:12px;line-height:1.5;text-align:center;">
                This is a confidential reference evaluation. Your responses will not be shared with the candidate.
                <br>This link expires in 30 days.
            </p>
        </div>
        <div style="text-align:center;padding:20px;">
            <p style="color:#8a97a8;font-size:11px;">Powered by BolsterMed — Reference Intelligence for Healthcare</p>
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
                results.email = emailRes.ok
                    ? { success: true, id: emailData.id }
                    : { success: false, error: emailData.message || 'Email failed' };
            } catch (emailErr) {
                results.email = { success: false, error: emailErr.message };
            }
        }

        // SMS via Twilio
        const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
        const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
        const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER;

        if (TWILIO_SID && TWILIO_TOKEN && TWILIO_PHONE && referencePhone) {
            try {
                let phone = referencePhone.replace(/[\s\-\(\)\.]/g, '');
                if (!phone.startsWith('+')) {
                    if (phone.startsWith('1') && phone.length === 11) phone = '+' + phone;
                    else if (phone.length === 10) phone = '+1' + phone;
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
                        To: phone,
                        From: TWILIO_PHONE,
                        Body: smsBody,
                    }).toString(),
                });

                const smsData = await smsRes.json();
                results.sms = (smsRes.ok || smsRes.status === 201)
                    ? { success: true, sid: smsData.sid }
                    : { success: false, error: smsData.message || 'SMS failed' };
            } catch (smsErr) {
                results.sms = { success: false, error: smsErr.message };
            }
        }

        // ── 5. Update invitation status to 'sent' ──
        await fetch(`${SUPABASE_URL}/rest/v1/survey_invitations?id=eq.${invitation.id}`, {
            method: 'PATCH',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ status: 'sent' }),
        });

        return res.status(200).json(results);

    } catch (err) {
        console.error('Submit candidate references error:', err);
        return res.status(500).json({ error: err.message });
    }
}

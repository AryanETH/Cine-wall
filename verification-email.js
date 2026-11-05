'use strict';

const { createHash } = require('node:crypto');
const oauthUrl = 'https://oauth2.googleapis.com/token';
const socials = [
  { label: 'LinkedIn', icon: 'in', color: '#0a66c2', url: 'https://www.linkedin.com/in/aryan686/' },
  { label: 'YouTube', icon: '▶', color: '#b42318', url: 'https://www.youtube.com/watch?v=nKjiv6_XSN4' },
  { label: 'GitHub', url: 'https://github.com/AryanETH/Cine-wall' },
];
const escapeHtml = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const subject = 'Verify your CineWall email address';
const ignore = 'If you didn’t ask to verify this address, you can ignore this email.';

function verificationMessage({ name, link }) {
  const displayName = (typeof name === 'string' ? name.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80) : '') || 'there';
  const href = escapeHtml(link);
  const socialLinks = socials.map(({ label, icon, color, url }) => `<a href="${url}" style="display:inline-block;margin:4px 12px 4px 0;color:#ddd8ec;text-decoration:underline">${icon ? `<span aria-hidden="true" style="display:inline-block;background:${color};color:#fff;padding:1px 4px;border-radius:3px;margin-right:4px;font-weight:bold">${icon}</span>` : ''}${label}</a>`).join('');
  return {
    subject,
    text: `Hello ${displayName},\n\nClick here to verify your email address: ${link}\n\nCan’t click? Copy and paste this link into your browser:\n${link}\n\n${ignore}\n\nThanks,\nTeam CineWall\n\n${socials.map(({ label, url }) => `${label}: ${url}`).join('\n')}`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;background:#100d1a;color:#f4f1fb;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#100d1a"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;table-layout:fixed;background:#201930;border:1px solid #3d3155;border-radius:18px">
<tr><td style="padding:26px 26px 0;color:#ceff51;font-size:19px;font-weight:bold;letter-spacing:2px">CINEWALL</td></tr>
<tr><td style="padding:12px 26px 26px">
<h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;color:#fff">Verify your email</h1>
<p style="margin:0 0 14px">Hello ${escapeHtml(displayName)},</p>
<p style="margin:0 0 22px"><a href="${href}" style="color:#ceff51;font-weight:bold;text-decoration:underline">Click here</a> to verify your email address.</p>
<p style="margin:0 0 6px;color:#ddd8ec;font-size:14px">Can’t click? Copy and paste this link into your browser:</p>
<p style="margin:0 0 22px;padding:12px;background:#100d1a;border-radius:8px;overflow-wrap:anywhere;word-break:break-all;font-size:13px"><a href="${href}" style="color:#cfc0ff">${href}</a></p>
<p style="margin:0 0 20px;color:#ddd8ec;font-size:14px">${ignore}</p>
<p style="margin:0">Thanks,<br><strong>Team CineWall</strong></p>
</td></tr>
<tr><td style="padding:14px 26px;border-top:1px solid #3d3155;font-size:13px">${socialLinks}</td></tr>
</table></td></tr></table></body></html>`,
  };
}

// A dedicated service account generates the Firebase action link. User tokens
// authenticate the send request; they cannot choose its recipient or URL.
function createVerificationSender({ projectId, env = process.env, request = fetch, now = Date.now } = {}) {
  const { CINEWALL_FIREBASE_MAIL_SERVICE_ACCOUNT: credentials, CINEWALL_RESEND_API_KEY: apiKey, CINEWALL_VERIFICATION_FROM: from } = env;
  if (!projectId || !credentials || !apiKey || !from) return null;
  let account;
  try { account = JSON.parse(credentials); }
  catch { console.error('Branded verification email: invalid service account configuration.'); return null; }
  if (account?.project_id !== projectId || !account.client_email || !account.private_key) {
    console.error('Branded verification email: the service account must belong to the configured Firebase project.');
    return null;
  }
  let token, expires = 0, refresh;
  async function requestJson(url, headers, body) {
    const response = await request(url, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Error('Verification provider rejected the request');
    return response.json();
  }
  async function googleToken() {
    if (token && expires > now()) return token;
    refresh ||= (async () => {
      const { importPKCS8, SignJWT } = await import('jose');
      const key = await importPKCS8(account.private_key, 'RS256');
      const iat = Math.floor(now() / 1000);
      const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/identitytoolkit' })
        .setProtectedHeader({ alg: 'RS256' }).setIssuer(account.client_email).setAudience(oauthUrl)
        .setIssuedAt(iat).setExpirationTime(iat + 300).sign(key);
      const result = await requestJson(oauthUrl, { 'Content-Type': 'application/x-www-form-urlencoded' },
        new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }));
      if (typeof result.access_token !== 'string' || !result.access_token) throw Error('Missing Google access token');
      token = result.access_token;
      expires = now() + Math.max(0, Number(result.expires_in) - 60) * 1000;
      return token;
    })().finally(() => { refresh = null; });
    return refresh;
  }
  return async ({ email, name }) => {
    const { oobLink } = await requestJson(
      `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:sendOobCode`,
      { Authorization: `Bearer ${await googleToken()}`, 'Content-Type': 'application/json' },
      JSON.stringify({ requestType: 'VERIFY_EMAIL', email, returnOobLink: true })
    );
    const link = new URL(oobLink);
    if (link.protocol !== 'https:' || link.searchParams.get('mode') !== 'verifyEmail' || !link.searchParams.has('oobCode')) throw Error('Invalid Firebase verification link');
    const idempotencyKey = createHash('sha256').update(link.href).digest('hex');
    await requestJson('https://api.resend.com/emails',
      { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      JSON.stringify({ from, to: [email], ...verificationMessage({ name, link: link.href }) })
    );
  };
}

module.exports = { verificationMessage, createVerificationSender };

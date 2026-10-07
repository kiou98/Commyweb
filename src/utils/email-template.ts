/**
 * Formatted HTML Email Generator for Commyweb
 * - Art Direction: Pure Black & White (Noir et Blanc)
 * - Typography: Satoshi & sans-serif
 * - Includes official Commyweb logo
 * - Magic authorization link
 * - Simple 2-step installation & usage instructions
 */

export interface EmailInviteParams {
  recipientEmail: string;
  invitedByName: string;
  pageUrl: string;
  authCode: string;
}

export function generateInviteEmailHtml(params: EmailInviteParams): string {
  const { recipientEmail, invitedByName, pageUrl, authCode } = params;
  
  // Magic link: opening this URL automatically authorizes the user's extension
  const magicLink = `${pageUrl}#commyweb_join=${authCode}&email=${encodeURIComponent(recipientEmail)}`;
  const logoUrl = 'https://raw.githubusercontent.com/kiou98/Commyweb/main/icons/logo.png';
  const releaseZipUrl = 'https://github.com/kiou98/Commyweb/releases/latest/download/commyweb-extension.zip';
  const releasesPageUrl = 'https://github.com/kiou98/Commyweb/releases';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invitation Commyweb</title>
  <style>
    @import url('https://api.fontshare.com/v2/css?f[]=satoshi@900,700,500,400&display=swap');
    body {
      margin: 0;
      padding: 0;
      background-color: #f4f4f5;
      font-family: 'Satoshi', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #000000;
      -webkit-font-smoothing: antialiased;
    }
    table {
      border-spacing: 0;
    }
    td {
      padding: 0;
    }
    img {
      border: 0;
    }
    .wrapper {
      width: 100%;
      table-layout: fixed;
      background-color: #f4f4f5;
      padding: 40px 16px;
    }
    .main-table {
      max-width: 580px;
      margin: 0 auto;
      background-color: #ffffff;
      border: 1px solid #000000;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
    }
    .header {
      padding: 36px 36px 24px;
      text-align: center;
      background-color: #ffffff;
      border-bottom: 1px solid #e4e4e7;
    }
    .logo {
      width: 54px;
      height: 54px;
      display: inline-block;
      margin-bottom: 12px;
    }
    .brand-title {
      font-size: 20px;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: #000000;
      margin: 0;
    }
    .content {
      padding: 36px;
      color: #18181b;
      line-height: 1.6;
      font-size: 15px;
    }
    .headline {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: #000000;
      margin-top: 0;
      margin-bottom: 16px;
      line-height: 1.3;
    }
    .target-box {
      background-color: #f4f4f5;
      border: 1px solid #e4e4e7;
      border-radius: 10px;
      padding: 14px 18px;
      margin: 20px 0 28px;
      word-break: break-all;
      font-size: 13px;
      font-weight: 600;
      color: #000000;
    }
    .cta-button {
      display: inline-block;
      background-color: #000000;
      color: #ffffff !important;
      text-decoration: none;
      font-weight: 800;
      font-size: 14px;
      padding: 16px 32px;
      border-radius: 10px;
      text-align: center;
      letter-spacing: -0.2px;
    }
    .steps-section {
      margin-top: 36px;
      padding-top: 28px;
      border-top: 1px solid #e4e4e7;
    }
    .step-title {
      font-size: 13px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: #000000;
      margin-bottom: 16px;
    }
    .step-item {
      display: flex;
      margin-bottom: 14px;
      font-size: 14px;
      line-height: 1.5;
    }
    .step-number {
      font-weight: 800;
      margin-right: 10px;
      color: #000000;
      min-width: 20px;
    }
    .kbd {
      background: #000000;
      color: #ffffff;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      display: inline-block;
    }
    .footer {
      padding: 24px 36px;
      background-color: #fafafa;
      border-top: 1px solid #e4e4e7;
      text-align: center;
      font-size: 12px;
      color: #71717a;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <table class="main-table" width="100%" cellpadding="0" cellspacing="0">
      <!-- En-tête -->
      <tr>
        <td class="header">
          <img src="${logoUrl}" alt="Commyweb" class="logo" />
          <h1 class="brand-title">Commyweb</h1>
        </td>
      </tr>

      <!-- Corps du message -->
      <tr>
        <td class="content">
          <h2 class="headline">Vous avez été invité à collaborer</h2>
          <p>Bonjour,</p>
          <p><strong>${invitedByName}</strong> vous a invité à réviser et commenter la page web suivante avec l'extension <strong>Commyweb</strong> :</p>
          
          <div class="target-box">
            👉 ${pageUrl}
          </div>

          <p style="text-align: center; margin: 32px 0;">
            <a href="${magicLink}" class="cta-button" target="_blank">
              Autoriser mon accès &amp; Rejoindre le projet →
            </a>
          </p>

          <!-- Guide d'installation et utilisation simple -->
          <div class="steps-section">
            <div class="step-title">Guide d'installation express (30 secondes)</div>

            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 10px;">
              <tr>
                <td width="28" valign="top" style="font-weight: 800; color: #000000;">1.</td>
                <td style="font-size: 13px; color: #18181b; padding-bottom: 12px;">
                  <strong>Téléchargez l'extension :</strong> Cliquez sur <a href="${releaseZipUrl}" style="color: #000000; font-weight: 700; text-decoration: underline;">commyweb-extension.zip</a> et décompressez le dossier.
                </td>
              </tr>
              <tr>
                <td width="28" valign="top" style="font-weight: 800; color: #000000;">2.</td>
                <td style="font-size: 13px; color: #18181b; padding-bottom: 12px;">
                  <strong>Activez dans Chrome :</strong> Allez sur <code>chrome://extensions</code>, activez le <strong>Mode développeur</strong> (en haut à droite), puis cliquez sur <strong>Charger l'extension non empaquetée</strong> et choisissez le dossier.
                </td>
              </tr>
              <tr>
                <td width="28" valign="top" style="font-weight: 800; color: #000000;">3.</td>
                <td style="font-size: 13px; color: #18181b;">
                  <strong>Commentez :</strong> Cliquez sur le bouton noir ci-dessus pour ouvrir le site. Appuyez sur <span class="kbd">Alt</span> + <span class="kbd">C</span> et cliquez n'importe où pour commenter comme dans Figma !
                </td>
              </tr>
            </table>
          </div>
        </td>
      </tr>

      <!-- Pied de page -->
      <tr>
        <td class="footer">
          Commyweb — Outil collaboratif open-source &amp; sécurisé (zéro base de données).<br>
          Code source et mises à jour disponibles sur <a href="${releasesPageUrl}" style="color: #000000; font-weight: 600;">GitHub</a>.
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`;
}

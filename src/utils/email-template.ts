/**
 * Formatted HTML Email Generator for Commyweb
 * - Art Direction: Pure Black & White (Noir et Blanc)
 * - Typography: Satoshi & sans-serif
 * - Includes official Commyweb logo
 * - Magic authorization link
 * - Simple 2-step installation & usage instructions
 */

export interface CommywebProjectConfig {
  repo?: string;
  token?: string;
  email: string;
  url: string;
  authCode?: string;
}

export function encodeProjectConfig(config: CommywebProjectConfig): string {
  try {
    const json = JSON.stringify(config);
    return btoa(encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))));
  } catch {
    return '';
  }
}

export function decodeProjectConfig(encoded: string): CommywebProjectConfig | null {
  try {
    const raw = atob(encoded);
    const json = decodeURIComponent(raw.split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export interface EmailInviteParams {
  recipientEmail: string;
  invitedByName: string;
  pageUrl: string;
  authCode: string;
  storageRepo?: string;
  githubToken?: string;
}

export function generateInviteEmailHtml(params: EmailInviteParams): string {
  const { recipientEmail, invitedByName, pageUrl, authCode, storageRepo, githubToken } = params;
  
  // Auto-configuration link: opening this URL automatically configures the collaborator's extension
  const encodedConfig = encodeProjectConfig({
    repo: storageRepo,
    token: githubToken,
    email: recipientEmail,
    url: pageUrl,
    authCode
  });
  
  const magicLink = encodedConfig
    ? `${pageUrl}#commyweb_config=${encodedConfig}`
    : `${pageUrl}#commyweb_join=${authCode}&email=${encodeURIComponent(recipientEmail)}`;
  const logotypeUrl = 'https://raw.githubusercontent.com/kiou98/Commyweb/main/icons/logotype.png';
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
        <td class="header" style="text-align: center; padding: 36px 36px 24px;">
          <img src="${logotypeUrl}" alt="Commyweb" style="height: 36px; max-width: 220px; display: inline-block; object-fit: contain;" />
        </td>
      </tr>

      <!-- Corps du message -->
      <tr>
        <td class="content">
          <h2 class="headline">Vous avez été invité à collaborer</h2>
          <p>Bonjour,</p>
          <p><strong>${invitedByName}</strong> vous invite à réviser et annoter la page web suivante avec l'extension <strong>Commyweb</strong> :</p>
          
          <div class="target-box">
            👉 <a href="${magicLink}" target="_blank" style="color: #000000; text-decoration: none; font-weight: 700;">${pageUrl}</a>
          </div>

          <div style="margin-bottom: 24px; background: #fafafa; border: 1px solid #e4e4e7; border-radius: 8px; padding: 10px 14px; font-size: 13px;">
            🔑 <strong>Accès validé pour :</strong> <code style="background: #ffffff; border: 1px solid #d4d4d8; padding: 2px 6px; border-radius: 4px; font-weight: 700;">${recipientEmail}</code><br>
            <span style="font-size: 12px; color: #52525b;">Votre accès a été validé d'office par l'administrateur. En ouvrant le lien, votre extension se synchronise automatiquement.</span>
          </div>

          <p style="text-align: center; margin: 28px 0;">
            <a href="${magicLink}" class="cta-button" target="_blank">
              Ouvrir le site &amp; Voir les commentaires →
            </a>
          </p>

          <!-- Guide d'installation et utilisation simple -->
          <div class="steps-section">
            <div class="step-title">Procédure d'installation du plugin Commyweb (30 secondes)</div>

            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 12px;">
              <tr>
                <td width="28" valign="top" style="font-weight: 800; color: #000000; font-size: 14px;">1.</td>
                <td style="font-size: 13.5px; color: #18181b; padding-bottom: 14px; line-height: 1.5;">
                  <strong>Téléchargez l'extension :</strong><br>
                  Téléchargez <a href="${releaseZipUrl}" style="color: #000000; font-weight: 700; text-decoration: underline;">commyweb-extension.zip ↗</a> et décompressez le dossier sur votre ordinateur.
                </td>
              </tr>
              <tr>
                <td width="28" valign="top" style="font-weight: 800; color: #000000; font-size: 14px;">2.</td>
                <td style="font-size: 13.5px; color: #18181b; padding-bottom: 14px; line-height: 1.5;">
                  <strong>Installez dans Chrome (ou Edge / Brave) :</strong><br>
                  Rendez-vous sur <code>chrome://extensions</code> dans votre navigateur, activez le bouton <strong>"Mode développeur"</strong> (en haut à droite), puis cliquez sur <strong>"Charger l'extension non empaquetée"</strong> et choisissez le dossier décompressé.
                </td>
              </tr>
              <tr>
                <td width="28" valign="top" style="font-weight: 800; color: #000000; font-size: 14px;">3.</td>
                <td style="font-size: 13.5px; color: #18181b; padding-bottom: 14px; line-height: 1.5;">
                  <strong>Retrouvez automatiquement tous les commentaires :</strong><br>
                  Cliquez sur le bouton noir ci-dessus pour ouvrir le site. Commyweb se configure automatiquement et affiche directement tous les commentaires de l'équipe sur la page !
                </td>
              </tr>
              <tr>
                <td width="28" valign="top" style="font-weight: 800; color: #000000; font-size: 14px;">4.</td>
                <td style="font-size: 13.5px; color: #18181b; line-height: 1.5;">
                  <strong>Commentez comme dans Figma :</strong><br>
                  Pour ajouter vos propres retours : faites simplement un <strong>clic droit</strong> sur n'importe quel élément de la page (ou appuyez sur <span class="kbd">Alt</span> + <span class="kbd">C</span>), saisissez votre remarque et envoyez !
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

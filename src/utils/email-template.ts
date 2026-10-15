/**
 * Formatted HTML Email Generator for Commyweb
 * - Art Direction: Pure Black & White (Noir et Blanc)
 * - Typography: Satoshi & sans-serif
 * - Includes official Commyweb logo
 * - Magic authorization link
 * - Ultra-clear 2-step procedure for collaborators
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
  const releaseZipUrl = 'https://github.com/kiou98/Commyweb/releases/latest/download/commyweb-user.zip';
  const releasesPageUrl = 'https://github.com/kiou98/Commyweb/releases';
  const displayRepo = storageRepo || 'Projet d\'équipe';

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
      padding: 32px 16px;
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
      padding: 32px 32px 20px;
      text-align: center;
      background-color: #ffffff;
      border-bottom: 1px solid #e4e4e7;
    }
    .content {
      padding: 32px;
      color: #18181b;
      line-height: 1.6;
      font-size: 14.5px;
    }
    .headline {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: #000000;
      margin-top: 0;
      margin-bottom: 14px;
      line-height: 1.3;
    }
    .summary-card {
      background-color: #fafafa;
      border: 1px solid #e4e4e7;
      border-radius: 10px;
      padding: 14px 18px;
      margin: 16px 0 24px;
      font-size: 13px;
      line-height: 1.6;
    }
    .summary-row {
      margin-bottom: 4px;
    }
    .summary-label {
      color: #71717a;
      font-weight: 600;
    }
    .summary-value {
      color: #000000;
      font-weight: 800;
    }
    .step-box {
      background-color: #ffffff;
      border: 1px solid #e4e4e7;
      border-radius: 12px;
      padding: 18px 20px;
      margin-bottom: 18px;
    }
    .step-header {
      display: flex;
      align-items: center;
      margin-bottom: 10px;
    }
    .step-badge {
      display: inline-block;
      background-color: #000000;
      color: #ffffff;
      font-size: 11px;
      font-weight: 800;
      padding: 3px 8px;
      border-radius: 6px;
      margin-right: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .step-title {
      font-size: 15px;
      font-weight: 800;
      color: #000000;
      margin: 0;
    }
    .step-body {
      font-size: 13.5px;
      color: #27272a;
      line-height: 1.55;
    }
    .cta-button {
      display: inline-block;
      background-color: #000000;
      color: #ffffff !important;
      text-decoration: none;
      font-weight: 800;
      font-size: 14px;
      padding: 14px 28px;
      border-radius: 8px;
      text-align: center;
      letter-spacing: -0.2px;
      margin-top: 10px;
    }
    .btn-download {
      display: inline-block;
      background-color: #f4f4f5;
      color: #000000 !important;
      border: 1px solid #000000;
      text-decoration: none;
      font-weight: 700;
      font-size: 12.5px;
      padding: 7px 14px;
      border-radius: 6px;
      margin: 6px 0;
    }
    .fallback-box {
      background: #fafafa;
      border: 1px dashed #d4d4d8;
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 11.5px;
      color: #52525b;
      word-break: break-all;
      margin-top: 14px;
    }
    .footer {
      padding: 20px 32px;
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
        <td class="header" style="text-align: center; padding: 32px 32px 20px;">
          <img src="${logotypeUrl}" alt="Commyweb" style="height: 32px; max-width: 200px; display: inline-block; object-fit: contain;" />
        </td>
      </tr>

      <!-- Corps du message -->
      <tr>
        <td class="content">
          <h2 class="headline">Invitation à réviser et commenter</h2>
          <p style="margin: 0 0 14px;">Bonjour,</p>
          <p style="margin: 0 0 14px;">
            <strong>${invitedByName}</strong> vous invite à collaborer et annoter une page web directement dans votre navigateur grâce à l'extension <strong>Commyweb</strong> (aucun compte GitHub requis).
          </p>
          
          <!-- Récapitulatif du Projet -->
          <div class="summary-card">
            <div class="summary-row">
              <span class="summary-label">📁 Projet :</span>
              <span class="summary-value">${displayRepo}</span>
            </div>
            <div class="summary-row">
              <span class="summary-label">🌐 Page à réviser :</span>
              <span class="summary-value" style="word-break: break-all;">${pageUrl}</span>
            </div>
            <div class="summary-row" style="margin-bottom: 0;">
              <span class="summary-label">🔑 Accès autorisé :</span>
              <span class="summary-value">${recipientEmail} (validé)</span>
            </div>
          </div>

          <div style="font-size: 14px; font-weight: 800; color: #000000; margin-bottom: 14px; text-transform: uppercase; letter-spacing: 0.5px;">
            Procédure simple en 2 étapes :
          </div>

          <!-- ÉTAPE 1 -->
          <div class="step-box">
            <div class="step-header">
              <span class="step-badge">Étape 1</span>
              <span class="step-title">Installer l'extension Collaborateur (30 sec)</span>
            </div>
            <div class="step-body">
              <em>(Si vous avez déjà l'extension installée, passez directement à l'étape 2)</em><br><br>
              <strong>1.</strong> Téléchargez le plugin :<br>
              <a href="${releaseZipUrl}" class="btn-download" target="_blank">⬇️ Télécharger commyweb-user.zip ↗</a><br>
              <em>Décompressez le fichier zip sur votre ordinateur.</em><br><br>
              <strong>2.</strong> Dans Chrome (ou Edge / Brave) :<br>
              Rendez-vous sur <code>chrome://extensions</code>, activez le bouton <strong>"Mode développeur"</strong> (en haut à droite), cliquez sur <strong>"Charger l'extension non empaquetée"</strong> et sélectionnez le dossier décompressé.
            </div>
          </div>

          <!-- ÉTAPE 2 -->
          <div class="step-box" style="border: 2px solid #000000; background: #ffffff;">
            <div class="step-header">
              <span class="step-badge" style="background: #16a34a;">Étape 2</span>
              <span class="step-title">Ouvrir la page &amp; Rejoindre le projet</span>
            </div>
            <div class="step-body">
              Cliquez sur le bouton ci-dessous pour ouvrir la page :<br>
              Votre extension se connecte <strong>automatiquement</strong> au projet <strong>${displayRepo}</strong> et affiche immédiatement tous les commentaires de l'équipe sur votre écran !
              
              <div style="text-align: center; margin: 18px 0 6px;">
                <a href="${magicLink}" class="cta-button" target="_blank">
                  👉 Ouvrir la page &amp; Voir les commentaires →
                </a>
              </div>

              <div class="fallback-box">
                <strong>Lien direct de secours :</strong> Si le bouton ne s'ouvre pas, collez ce lien dans votre navigateur :<br>
                <a href="${magicLink}" target="_blank" style="color: #000000; text-decoration: underline;">${magicLink}</a>
              </div>
            </div>
          </div>

          <!-- ÉTAPE 3 -->
          <div class="step-box">
            <div class="step-header">
              <span class="step-badge">Astuce</span>
              <span class="step-title">Commenter comme dans Figma</span>
            </div>
            <div class="step-body">
              Pour ajouter vos remarques sur le site : faites simplement un <strong>clic droit</strong> sur n'importe quel élément de la page (ou appuyez sur les touches <kbd style="background: #000; color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 700;">Alt</kbd> + <kbd style="background: #000; color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 700;">C</kbd>), écrivez votre message et validez. Vos collègues le verront instantanément !
            </div>
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

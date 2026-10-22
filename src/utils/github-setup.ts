import { parseGitHubRepo } from './github-parser';
import { projectLink } from './email-template';
import { RealtimeConfig } from '../types';
import { escapeHtml } from './security';

/** Only documented GitHub template parameters; repository selection stays explicit. */
export function githubTokenUrl(repository?: string): string {
  const repo = parseGitHubRepo(repository);
  const url = new URL('https://github.com/settings/personal-access-tokens/new');
  url.searchParams.set('name', `Commyweb${repo ? ` - ${repo.repo}` : ''}`.slice(0, 40));
  url.searchParams.set('description', 'Commentaires Commyweb : lecture et écriture des Issues du projet choisi');
  url.searchParams.set('expires_in', '30');
  url.searchParams.set('issues', 'write');
  url.searchParams.set('metadata', 'read');
  if (repo) url.searchParams.set('target_name', repo.owner);
  return url.href;
}

export function githubProjectUrl(repository?: string): string | null {
  const repo = parseGitHubRepo(repository);
  return repo ? `https://github.com/${repo.fullName}` : null;
}

export function invitationEmail(pageUrl: string, repository?: string, author = 'Votre équipe', realtime?: RealtimeConfig, magicLink?: string) {
  const repo = parseGitHubRepo(repository);
  const directLink = projectLink(pageUrl, repo?.fullName, realtime);
  const link = magicLink || directLink;
  const subject = `${author} vous invite à commenter ${new URL(pageUrl).hostname}`;
  const body = `Bonjour,\n\n${author} vous invite à laisser vos retours sur ${new URL(pageUrl).hostname} avec Commyweb.\n\nSuivez ces étapes sur ordinateur, avec Chrome, Edge ou Brave. Si Commyweb Utilisateur est déjà installé dans ce navigateur, passez directement à l’étape 6.\n\n`
    + `1. Téléchargez l’extension Commyweb Utilisateur :\nhttps://commyweb.neonea.nc/downloads/commyweb-user.zip\n\n`
    + `2. Décompressez le fichier ZIP téléchargé (clic droit, puis « Extraire tout »). Gardez le dossier obtenu pour l’étape 5.\n\n`
    + `3. Copiez chrome://extensions dans la barre d’adresse de Chrome ou Brave, puis appuyez sur Entrée. Sur Edge, utilisez edge://extensions.\n\n`
    + `4. Activez l’interrupteur « Mode développeur » sur cette page.\n\n`
    + `5. Cliquez sur « Charger l’extension non empaquetée », puis sélectionnez le dossier décompressé à l’étape 2 (celui qui contient manifest.json). Commyweb apparaît dans la liste des extensions.\n\n`
    + (magicLink ? `6. Ouvrez votre lien personnel ci-dessous dans le navigateur où Commyweb est installé :\n${link}\nL’extension rejoint automatiquement le projet : aucun compte GitHub ni jeton à renseigner.\n\n` : repo ? `6. Ouvrez la page à commenter :\n${link}\nPuis ouvrez les réglages Commyweb depuis le menu Extensions du navigateur (icône en forme de puzzle). Le projet ${repo.fullName} est déjà sélectionné. Cliquez sur « Créer mon jeton GitHub », choisissez uniquement le dépôt ${repo.repo}, puis collez votre jeton et cliquez sur « Vérifier et connecter ».\n\n`
      + `La configuration se fait dans la modale de l’extension. Après avoir créé votre jeton sur GitHub, revenez sur la page à commenter et rouvrez Commyweb pour le coller.\n\nVotre compte GitHub doit avoir accès au dépôt ${githubProjectUrl(repo.fullName)}. Si l’accès est refusé, demandez au responsable du projet de vous y inviter sur GitHub.\n\n` : `6. Ouvrez la page :\n${link}\nConnectez le même projet GitHub pour partager vos commentaires. Sans connexion GitHub, vos commentaires restent sur votre appareil.\n\n`)
    + `7. Sur la page à commenter, ouvrez Commyweb depuis le menu Extensions du navigateur (icône en forme de puzzle). Vérifiez que « Activer les commentaires » est activé.\n\n`
    + `8. Cliquez sur « Ajouter un commentaire », puis sur l’endroit de la page concerné.\n\n`
    + `9. Écrivez votre retour, puis cliquez sur le bouton d’envoi.\n\n`
    + (magicLink ? `Conservez cet email pour revenir sur la page avec votre lien personnel (étape 6). Ce lien donne accès aux commentaires de ce site pendant 30 jours, sauf révocation par le responsable. Gardez-le pour vous.\n\n` : '')
    + `À bientôt !`;
  // Escape every user-supplied value before adding email-safe markup and links.
  const paragraphs = body.split('\n\n').map(paragraph => {
    const parts = paragraph.split(/(https?:\/\/[^\s]+)/g);
    const content = parts.map((part, index) => {
      if (index % 2 === 0) return escapeHtml(part).replace(/\n/g, '<br>');
      const label = part === link ? 'Ouvrir la page à commenter' : part.endsWith('/commyweb-user.zip') ? 'Télécharger Commyweb Utilisateur' : part;
      return `<a href="${escapeHtml(part)}" style="color:#2563eb;text-decoration:underline;overflow-wrap:anywhere">${escapeHtml(label)}</a>`;
    }).join('').replace(/^(\d+\.) /, '<strong>$1</strong> ');
    return `<p style="margin:0 0 16px">${content}</p>`;
  }).join('');
  const html = `<div lang="fr" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#17202a;max-width:640px"><p style="font-weight:bold;color:#2563eb;margin:0 0 8px">Commyweb</p><h2 style="font-size:20px;line-height:1.3;margin:0 0 24px">Objet : ${escapeHtml(subject)}</h2>${paragraphs}</div>`;
  return { subject, body, html, link };
}

export function validateInvitationRecipient(recipient: string): void {
  if (!/^[^\s@,;?\r\n]+@[^\s@,;?\r\n]+\.[^\s@,;?\r\n]+$/.test(recipient)) throw new Error('Saisissez une adresse email valide.');
}

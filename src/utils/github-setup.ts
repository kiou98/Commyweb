import { parseGitHubRepo } from './github-parser';
import { projectLink } from './email-template';
import { RealtimeConfig } from '../types';

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
  const body = `Bonjour,\n\n${author} vous invite à laisser vos retours sur cette page avec Commyweb :\n${link}\n\n`
    + `1. Installez l’extension Utilisateur (si nécessaire) :\nhttps://commyweb.neonea.nc/downloads/commyweb-user.zip\nDécompressez l’archive, ouvrez chrome://extensions, activez le mode développeur puis chargez le dossier décompressé.\n\n`
    + (magicLink ? `2. Cliquez sur votre lien personnel ci-dessus. L’extension rejoint automatiquement le projet : aucun compte GitHub ni jeton à renseigner. Ce lien donne accès aux commentaires de ce site pendant 30 jours, sauf révocation par le responsable. Gardez-le pour vous.\n\n` : repo ? `2. Ouvrez le lien de la page ci-dessus, puis les réglages Commyweb. Le projet ${repo.fullName} est déjà sélectionné. Cliquez sur « Créer mon jeton GitHub », choisissez uniquement le dépôt ${repo.repo}, puis collez votre jeton et cliquez sur « Vérifier et connecter ».\n\n`
      + `La configuration se fait dans la modale de l’extension. Après avoir créé votre jeton sur GitHub, revenez sur la page à commenter et rouvrez Commyweb pour le coller.\n\nVotre compte GitHub doit avoir accès au dépôt ${githubProjectUrl(repo.fullName)}. Si l’accès est refusé, demandez au responsable du projet de vous y inviter sur GitHub.\n\n` : `2. Ouvrez la page et connectez le même projet GitHub pour partager vos commentaires. Sans connexion GitHub, vos commentaires restent sur votre appareil.\n\n`)
    + `3. Cliquez sur « Ajouter un commentaire », choisissez un endroit sur la page et envoyez votre retour.\n\nÀ bientôt !`;
  return { subject, body, link };
}

export function invitationMailto(recipient: string, subject: string, body: string): string {
  if (!/^[^\s@,;?\r\n]+@[^\s@,;?\r\n]+\.[^\s@,;?\r\n]+$/.test(recipient)) throw new Error('Saisissez une adresse email valide.');
  return `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

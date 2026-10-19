import { decodeProjectConfig, projectLink } from '../utils/email-template';

function renderInvitation() {
const encoded = new URLSearchParams(location.hash.slice(1)).get('commyweb_config');
const config = encoded ? decodeProjectConfig(encoded) : null;
const summary = document.getElementById('project-summary')!;
document.getElementById('join-steps')!.hidden = true;
if (!config?.repo) {
  summary.textContent = 'Cette invitation est incomplète. Demandez au responsable de vous renvoyer le lien depuis le bouton « Inviter » de Commyweb.';
} else {
  summary.textContent = `Projet : ${config.repo}`;
  (document.getElementById('open-page') as HTMLAnchorElement).href = projectLink(config.url, config.repo, config.realtime, config.invitation);
  document.getElementById('page-label')!.textContent = config.url;
  document.getElementById('invitation-help')!.textContent = config.invitation
    ? 'Aucun compte GitHub ni jeton à renseigner. Votre lien est personnel et le responsable peut retirer cet accès.'
    : 'Ce lien provient d’une ancienne version. Demandez au responsable une nouvelle invitation depuis Commyweb Admin.';
  document.getElementById('join-steps')!.hidden = false;
  history.replaceState(history.state, '', `${location.pathname}${new URL(projectLink(config.url, config.repo, config.realtime, config.invitation)).hash}`);
}
}
renderInvitation();
window.addEventListener('hashchange', renderInvitation);

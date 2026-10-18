import { decodeProjectConfig, projectLink } from '../utils/email-template';
import { githubTokenUrl, githubProjectUrl } from '../utils/github-setup';

function renderInvitation() {
const encoded = new URLSearchParams(location.hash.slice(1)).get('commyweb_config');
const config = encoded ? decodeProjectConfig(encoded) : null;
const summary = document.getElementById('project-summary')!;
document.getElementById('join-steps')!.hidden = true;
if (!config?.repo) {
  summary.textContent = 'Cette invitation est incomplète. Demandez au responsable de vous renvoyer le lien depuis le bouton « Inviter » de Commyweb.';
} else {
  summary.textContent = `Projet : ${config.repo}`;
  document.getElementById('repo-instructions')!.textContent = `Le projet de votre équipe est ${config.repo}. Cliquez ci-dessous pour créer votre jeton personnel avec les permissions utiles déjà préremplies.`;
  (document.getElementById('create-token') as HTMLAnchorElement).href = githubTokenUrl(config.repo);
  (document.getElementById('project-link') as HTMLAnchorElement).href = githubProjectUrl(config.repo)!;
  (document.getElementById('open-page') as HTMLAnchorElement).href = projectLink(config.url, config.repo, config.realtime);
  document.getElementById('page-label')!.textContent = config.url;
  document.getElementById('join-steps')!.hidden = false;
  history.replaceState(history.state, '', `${location.pathname}${new URL(projectLink(config.url, config.repo, config.realtime)).hash}`);
}
}
renderInvitation();
window.addEventListener('hashchange', renderInvitation);

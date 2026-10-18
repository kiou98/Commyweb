# Page de présentation Commyweb

La page présente le bénéfice avant l’installation : commenter un élément précis, garder les réponses ensemble et suivre les corrections. Un exemple illustratif explique le fonctionnement sans simuler une interface interactive. L’action principale reste le téléchargement ; le contact Néonéa est accessible dans la navigation, dans une section dédiée et en pied de page.

## Identité visuelle

Référence : https://neonea.nc/ et son formulaire https://neonea.nc/#contact, vérifiés le 19 octobre 2026. Noir et blanc, grands titres, typographie Satoshi, navigation en pastilles et boutons rectangulaires. La police est servie par Fontshare avec `font-display: swap` et une police système de secours ; aucun fichier de police propriétaire n’est redistribué dans le dépôt.

## Vérifications

Le guide présente trois étapes avec des captures de l’extension : configuration du projet, invitation par email, puis commentaire du collaborateur. Les données sont fictives et les détails secondaires sont masqués uniquement dans les captures. `npm run capture:site` régénère les images depuis des profils Chromium isolés ; la page ne reçoit aucun jeton.

- Page principale statique utilisable sans JavaScript ; aucune vidéo, animation ou dépendance JavaScript pour la présentation.
- HTML sémantique, titre principal unique, lien d’évitement, focus visible, accordéons natifs et audit automatisé axe sur ordinateur et mobile.
- Contrôle des débordements à 320, 375, 768 et 1280 pixels ; invitation historique également vérifiée sur mobile.
- Description, URL canonique, métadonnées de partage avec image 1200 × 630, favicon, sitemap et robots.txt. L’invitation reste en `noindex`.
- Téléchargement de l’archive réellement testé ; aucune saisie de jeton ou de projet sur le site public.
- Invitations dirigées vers la page à commenter. Configuration dans la modale de l’extension, lien vers GitHub pour générer le jeton, brouillon du nom du projet conservé pendant cet aller-retour. Icône d’invitation « personne + » d’origine restaurée.

## Limites explicites

L’installation actuelle est manuelle sur ordinateur. La collaboration nécessite les accès GitHub de chaque participant. L’actualisation périodique et le relais facultatif sont expliqués sans annoncer un service temps réel déjà hébergé. Les audits automatisés ne remplacent pas un audit complet d’accessibilité ni des tests utilisateurs ; l’amélioration de conversion ou du référencement n’est pas garantie par ces vérifications.

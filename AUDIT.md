# Commyweb — analyse et corrections, version 1.6.0

Travail réalisé le 19 octobre 2026 à partir du dépôt `kiou98/Commyweb`. Les modifications sont regroupées sur la branche `codex/simplify-experience`.

## Ce qui compliquait l’expérience

| Constat dans la version 1.5.6 | Correction livrée |
| --- | --- |
| Le mode commentaire s’activait par défaut et interceptait les clics sur les sites. | Placement volontaire, ponctuel, puis retour à la navigation. Les pastilles restent consultables. |
| Le même raccourci était traité par le service worker et par la page. | Un seul gestionnaire du raccourci Chrome. |
| La popup utilisée par la compilation différait d’une autre popup source plus complète. | Une seule source HTML et un parcours cohérent. |
| Paramètres, invitations, membres et dépôts formaient plusieurs volets redondants. | Deux volets : réglages du site et partage. L’action principale et les discussions restent prioritaires. |
| Deux éditions masquaient des réglages nécessaires aux collaborateurs. | Une édition pour tout le monde ; anciens noms d’archives conservés comme alias. |
| Le nom par défaut était celui du développeur. | Nom choisi par l’utilisateur ; auteur « Invité » si aucun nom n’est renseigné. |
| Les actualisations pouvaient partir toutes les 1,5 seconde, même sans changement. | Rafraîchissement toutes les 15 secondes sur les pages visibles, requêtes simultanées regroupées, notifications des modifications entre onglets. |
| Une lecture des réglages d’un site pouvait modifier les réglages globaux. | Lecture sans effet de bord ; associations propres à chaque site et mode local explicite. |
| Des commentaires locaux d’autres projets pouvaient être envoyés au dépôt courant. | Cache filtré par dépôt ; les commentaires locaux ne sont pas exportés automatiquement. |
| Des réponses ou réouvertures pouvaient être écrasées par des données distantes anciennes. | Changements en attente conservés ; protection contre les réponses arrivées pendant une écriture ; réouvertures distantes prises en compte. |
| Les statuts HTTP des réponses, résolutions et déplacements étaient ignorés. | Statuts vérifiés, délai réseau borné et indication honnête de l’état local ou partagé. |
| La récupération s’arrêtait à 100 discussions. | Lecture des pages de résultats suivantes. |
| Les coordonnées pouvaient être incorrectes avec des identifiants CSS spéciaux ou des zones défilantes. | Identifiants échappés, sélecteurs de fratrie précis, position absolue de secours et suivi des défilements internes. |
| Une fermeture de dialogue ne réinitialisait pas complètement son état. | Fermeture cohérente, brouillons gardés en mémoire et envois protégés contre les doublons. |
| Les dialogues utilisaient une hauteur fixe estimée et pouvaient sortir de l’écran. | Positionnement d’après leurs dimensions réelles et limites de la fenêtre. |
| La commande de développement ne reconstruisait pas le script injecté. | Surveillance des deux compilations. |

## Partage et droits

Les anciens liens transportaient un jeton GitHub encodé en base64 et présentaient un accès limité à une page ainsi qu’une révocation locale. Le code ne faisait pas respecter ces limites côté GitHub.

La version livrée retire le jeton des nouveaux liens, ignore les jetons des anciens liens et laisse les droits à GitHub. Chaque collaborateur doit utiliser son propre compte et son propre jeton. La sélection du dépôt reste simple à partager. Les jetons ne sont plus copiés dans `chrome.storage.sync`.

Les fonctions d’invitation sans compte et de révocation depuis Commyweb ont été retirées de l’interface : elles donnaient une assurance que le modèle actuel ne pouvait pas garantir. Les anciens enregistrements locaux ne sont pas effacés.

## Vérifications effectuées

- Compilation TypeScript stricte et compilation de production des deux parties de l’extension.
- **22 tests automatisés de stockage et de synchronisation réussis**, dont écritures concurrentes, séparation des projets, reprise hors ligne, résolution, pagination, anciennes invitations et validation des URL.
- **10 groupes de vérifications navigateur réussis**, dans un profil Chromium temporaire avec l’extension réellement chargée : navigation initiale, commentaire multiligne, reprise de navigation, clavier et brouillons, réponse, résolution/réouverture/rechargement, déplacement, petite fenêtre, invitation ancienne sans import de jeton, réglages et navigation SPA, défilement interne, absence d’erreur JavaScript non interceptée. Les groupes rassemblent plusieurs assertions.
- Inspection visuelle des vues vides, liste de discussions et dialogue de réponse.
- Archives d’installation et de sources produites ; contrôle des entrées nécessaires et de la correspondance des versions.

Les tests GitHub utilisent des réponses simulées. Aucun jeton réel, aucune écriture sur un dépôt distant, aucun envoi d’invitation et aucune publication n’ont été effectués. Les essais ouvrent la popup dans un onglet de test et lui fournissent les métadonnées d’URL normalement accordées par un clic sur l’icône de l’extension ; les autres mécanismes de l’extension restent réels.

## Allègement mesuré

Le JavaScript compilé de la popup passe d’environ **45,7 Ko à 13,1 Ko**, soit **71 % de moins** avant compression. Sa source HTML passe d’environ 16,2 Ko à 5,4 Ko. Le script injecté est légèrement plus gros, car il inclut désormais la gestion locale nécessaire à la confirmation d’enregistrement avant fermeture du brouillon.

Ces mesures comparent les sorties de compilation de la version initiale et de la version modifiée. Elles ne constituent pas un benchmark de latence sur tous les sites web.

## Limites restantes

- Les écritures dans le corps d’une même Issue depuis plusieurs ordinateurs ne sont pas transactionnelles. Une vraie gestion des conflits simultanés demanderait un protocole de réponses indépendantes ou un service dédié.
- Les droits GitHub s’appliquent au dépôt, pas à une page. Les invitations sans compte et les droits fins par page demanderaient une autre architecture d’authentification.
- Les routes entièrement fondées sur le fragment d’URL partagent encore une URL normalisée.
- La popup est en français ; les commandes sur la page restent traduites en français/anglais selon Chrome.
- Un brouillon non envoyé survit à la fermeture du dialogue, mais pas au rechargement complet de la page.
- Les pages internes du navigateur, les boutiques d’extensions et certaines pages protégées ne permettent pas l’injection.

## Installation de la version locale

Décompressez `release/commyweb-extension-v1.6.0.zip`, puis chargez le dossier dans `chrome://extensions` en mode développeur. Si vous utilisez déjà Commyweb, remplacez les fichiers dans son dossier d’installation existant avant de recharger l’extension, afin de conserver son identité et son stockage local.

Les sources modifiées sont également disponibles dans `release/commyweb-source-v1.6.0.zip`. Le guide complet est dans [README.fr.md](README.fr.md).

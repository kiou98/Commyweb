# Commyweb

Des retours précis, directement sur les pages web. Extension Chrome / Edge / Brave, open source. Mode local sans serveur ; collaboration GitHub et relais temps réel facultatif.

[English](README.md) · [Architecture](ARCHITECTURE.md) · [Bilan des changements](AUDIT.md)

La présentation et le téléchargement sont disponibles sur [commyweb.neonea.nc](https://commyweb.neonea.nc). L’adresse Netlify historique reste disponible pour les anciens liens. Les invitations ouvrent directement la page à commenter avec le projet déjà sélectionné. Toute la configuration du projet se fait dans la modale de l’extension ; seule la création du jeton passe par GitHub. Les anciens liens `/join.html` restent lisibles.

## Commencer

1. Téléchargez `commyweb-admin.zip` pour gérer le projet, ou `commyweb-user.zip` si vous avez reçu une invitation. Décompressez l’archive. Installez une seule édition par navigateur.
2. Ouvrez `chrome://extensions`, activez **Mode développeur**, puis **Charger l’extension non empaquetée**.
3. Sélectionnez le dossier décompressé. Ouvrez une page web puis Commyweb.
4. Saisissez votre nom, cliquez sur **Ajouter un commentaire**, puis choisissez un endroit sur la page.

Le mode local fonctionne immédiatement, sans compte ni configuration. Après l’envoi, vous pouvez naviguer normalement ; les pastilles restent visibles.

Pour utiliser une version compilée localement, chargez `dist-admin` ou `dist-user` (`dist` conserve l’édition de développement avec réglages). Pour mettre à jour une installation existante, remplacez les fichiers dans **le même dossier**, puis cliquez sur Recharger dans la page des extensions. Une installation dans un autre dossier peut recevoir un autre identifiant et ne pas retrouver le stockage local précédent.

## Au quotidien

- **Ajouter** : bouton dans Commyweb, clic droit → Ajouter un commentaire Commyweb, ou `Alt+C`.
- **Activer les commentaires** : le toggle masque ou affiche les annotations. Son état est conservé après rechargement ; il n’empêche pas la navigation normale.
- **Envoyer** : Entrée. **Nouvelle ligne** : Maj+Entrée.
- **Annuler le placement / fermer** : Échap. Les brouillons sont conservés en mémoire pendant la vie de la page.
- **Consulter** : cliquez sur une pastille, ou utilisez Tab puis Entrée / Espace.
- **Répondre, résoudre, rouvrir** : depuis la discussion ou la liste de Commyweb. Les discussions résolues restent consultables.
- **Déplacer** : faites glisser une pastille sur sa nouvelle cible.
- **Filtrer** : Toutes, À traiter, Résolues.

Les annotations sont associées à l’URL de la page. Les paramètres de suivi marketing et fragments sont ignorés. Les changements d’URL dans les applications web sont détectés en une seconde environ.

## Travailler en équipe

1. Installez l’édition Admin et créez un dépôt GitHub privé avec les Issues activées. Les collaborateurs n’ont pas besoin d’un compte GitHub.
2. Sur le site concerné, ouvrez les réglages dans la modale Commyweb. Cliquez sur **Garder la configuration ouverte** pour utiliser le panneau latéral pendant vos recherches sur GitHub : il reste associé au site de départ, même si vous changez d’onglet. Collez l’URL du projet GitHub. Les saisies et la vue ouverte sont conservées sur cet appareil à chaque modification ; un brouillon ne connecte pas encore le projet.
3. Cliquez sur **Créer mon jeton GitHub** : le propriétaire et les permissions **Issues : Read and write** sont préremplis. Dans GitHub, choisissez **Only select repositories**, sélectionnez précisément le projet indiqué et générez le jeton.
4. Collez votre jeton dans Commyweb. **Choisir parmi mes projets GitHub** permet de retrouver les dépôts accessibles sans recopier leur nom. Cliquez sur **Vérifier et connecter** : la lecture du projet et des Issues est contrôlée sans créer de données de test. Les droits d’écriture seront nécessaires pour commenter.
5. Cliquez sur l’icône **Inviter un collaborateur** (personne avec un signe +), saisissez l’email du collaborateur puis **Préparer l’email d’invitation**. Un brouillon s’ouvre dans votre messagerie : **vérifiez-le puis cliquez sur Envoyer**. Si votre messagerie ne s’ouvre pas, utilisez **Copier l’email complet**. Aucun email ne part automatiquement.

L’email contient l’extension Utilisateur et un lien magique personnel. Le collaborateur installe cette édition puis ouvre le lien : le projet se connecte automatiquement, sans jeton ni réglage GitHub. Les invitations en cours sont visibles dans le volet Inviter ; **Retirer l’accès** invalide le lien côté serveur. Les liens expirent après 30 jours.

Chaque site peut utiliser un dépôt et un jeton différents. Le bouton **Utiliser le mode local** revient aux annotations locales sans effacer les annotations d’équipe. Les commentaires créés en local restent locaux : ils ne sont pas envoyés automatiquement à un dépôt que vous venez de connecter.

**Le lien est une autorisation personnelle : gardez-le privé.** Il donne accès aux discussions Commyweb du site concerné via le service Netlify, pas au dépôt GitHub en général. Il ne contient jamais le jeton GitHub de l’admin. Les anciens liens qui contenaient ce jeton ne sont pas réactivés : renvoyez une nouvelle invitation depuis Admin.

## Stockage et synchronisation

Les commentaires sont d’abord enregistrés dans `chrome.storage.local`. Les discussions d’équipe sont ensuite stockées dans les Issues du dépôt choisi. Les réponses et coordonnées sont sérialisées dans le corps de l’Issue ; résoudre une discussion ferme l’Issue.

Les créations, réponses, résolutions et déplacements sont confirmés après la sauvegarde locale, sans attendre GitHub. La synchronisation continue en arrière-plan. Une réponse tardive ne doit pas effacer une modification faite entre-temps ; un POST dont l’accusé a été perdu est recherché dans GitHub avant une nouvelle tentative, avec un délai de reprise.

Le jeton de l’admin reste sur son appareil et, à la création d’une invitation, est aussi enregistré dans Netlify Blobs pour le service d’accès. Netlify chiffre ce stockage au repos et en transit. Les secrets des liens sont stockés sous forme d’empreintes côté serveur. Les jetons GitHub et autorisations de l’extension sont exclus des préférences synchronisées par Chrome. La révocation coupe les futurs accès réseau ; elle ne peut pas supprimer des données déjà consultées ou conservées sur l’appareil du collaborateur.

Avec un relais connecté, les changements Commyweb confirmés par GitHub sont signalés immédiatement aux autres navigateurs. Le statut indique **Temps réel actif** seulement après connexion effective. Le relais se reconnecte automatiquement en cas de coupure ; l’affichage dépend aussi du délai de réponse de GitHub.

Le responsable configure une fois l’adresse `wss://…/sync` dans les réglages avancés. Les invitations la transmettent automatiquement aux collaborateurs. Voir le [guide de déploiement du relais autonome](relay/README.md). Aucun jeton ou texte de commentaire n’est transmis au relais.

Sans relais, ou en cas de panne, les pages visibles gardent un rafraîchissement de secours toutes les 15 secondes. Les modifications faites directement dans GitHub sont aussi récupérées par ce filet de sécurité. Les pages internes du navigateur et les pages qui interdisent les extensions ne sont pas annotables.

## Développement

Node.js 20+ et npm.

```bash
npm ci
npm run build
npm run dev
```

`dev` reconstruit à la fois le service worker, la popup et le script injecté. Rechargez l’extension et la page pour utiliser les nouvelles versions des scripts.

```bash
npm test
npx playwright install chromium
npm run test:browser
npm run package
npm run test:site
```

Les essais navigateur chargent réellement l’extension dans un profil Chromium temporaire. Ils ne touchent pas au profil courant et n’accèdent pas à un compte GitHub réel. Les réponses de l’API GitHub sont simulées dans les tests de synchronisation.

Les archives se trouvent dans `release/`. Les éditions Admin et Utilisateur ont des interfaces distinctes et sont aussi compilées dans `dist-admin` et `dist-user`. L’édition Utilisateur n’a pas d’autorisation d’accès direct à l’API GitHub. Les sources sont dans `commyweb-source-v*.zip`, le relais autonome dans `commyweb-realtime-relay-v*.zip`.

## Guide public sur Netlify

Le projet Netlify `commyweb` suit actuellement la branche `codex/simplify-experience`. Chaque push sur cette branche déclenche une publication sur `https://commyweb.neonea.nc` (également accessible via `https://commyweb.netlify.app`).

Le sous-domaine est rattaché à ce projet Netlify. Dans la zone DNS Cloudflare de `neonea.nc`, le CNAME `commyweb` pointe vers `commyweb.netlify.app`, en mode DNS uniquement. Netlify gère le certificat HTTPS. Les URL canoniques, les métadonnées de partage et le sitemap utilisent le sous-domaine Néonéa.

Le fichier `netlify.toml` compile le guide via `npm run build:site` et publie `site-dist`, avec l’archive de l’extension dans `/downloads/`. Le dossier `dist` est une extension de navigateur et ne doit pas servir de site web public. `npm run test:site` vérifie le téléchargement, les invitations, l’affichage mobile et les liens invalides.

Le guide est statique. La fonction `netlify/functions/collaboration.mjs` gère les invitations et les appels GitHub limités au site et au projet autorisés ; Netlify Blobs conserve les autorisations entre les déploiements. Aucun serveur supplémentaire ni variable secrète manuelle n’est requis sur Netlify. Le service dépend des droits et de la validité du jeton de l’admin. Il n’exécute pas le serveur WebSocket du dossier `relay/` : son déploiement et son URL restent nécessaires pour le temps réel entre collaborateurs.

## Limites connues

Les mises à jour d’une même Issue par plusieurs ordinateurs exactement au même moment ne sont pas transactionnelles. Commyweb relit la discussion avant écriture et fusionne les réponses, mais GitHub ne fournit pas de transaction atomique pour ce modèle. Les invitations concernent les discussions du site autorisé, pas une seule page. Leur email identifie l’invité ; la possession du lien fait autorisation et ne constitue pas une preuve d’identité.

La popup est en français ; les commandes des discussions sur la page utilisent les traductions Chrome françaises ou anglaises. Les routes stockées uniquement dans le fragment d’URL partagent actuellement les annotations d’une même URL normalisée.

Licence MIT.

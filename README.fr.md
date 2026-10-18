# Commyweb

Des retours précis, directement sur les pages web. Extension Chrome / Edge / Brave, open source, sans serveur à héberger.

[English](README.md) · [Architecture](ARCHITECTURE.md) · [Bilan des changements](AUDIT.md)

## Commencer

1. Téléchargez et décompressez `commyweb-extension.zip` depuis les versions publiées du projet.
2. Ouvrez `chrome://extensions`, activez **Mode développeur**, puis **Charger l’extension non empaquetée**.
3. Sélectionnez le dossier décompressé. Ouvrez une page web puis Commyweb.
4. Saisissez votre nom, cliquez sur **Ajouter un commentaire**, puis choisissez un endroit sur la page.

Le mode local fonctionne immédiatement, sans compte ni configuration. Après l’envoi, vous pouvez naviguer normalement ; les pastilles restent visibles.

Pour utiliser une version compilée localement, chargez le dossier `dist`. Pour mettre à jour une installation existante, remplacez les fichiers dans **le même dossier**, puis cliquez sur Recharger dans la page des extensions. Une installation dans un autre dossier peut recevoir un autre identifiant et ne pas retrouver le stockage local précédent.

## Au quotidien

- **Ajouter** : bouton dans Commyweb, clic droit → Ajouter un commentaire Commyweb, ou `Alt+C`.
- **Envoyer** : Entrée. **Nouvelle ligne** : Maj+Entrée.
- **Annuler le placement / fermer** : Échap. Les brouillons sont conservés en mémoire pendant la vie de la page.
- **Consulter** : cliquez sur une pastille, ou utilisez Tab puis Entrée / Espace.
- **Répondre, résoudre, rouvrir** : depuis la discussion ou la liste de Commyweb. Les discussions résolues restent consultables.
- **Déplacer** : faites glisser une pastille sur sa nouvelle cible.
- **Filtrer** : Toutes, À traiter, Résolues.

Les annotations sont associées à l’URL de la page. Les paramètres de suivi marketing et fragments sont ignorés. Les changements d’URL dans les applications web sont détectés en une seconde environ.

## Travailler en équipe

1. Créez un dépôt GitHub privé et donnez aux collaborateurs les droits nécessaires dans GitHub.
2. Chaque personne crée son **propre jeton GitHub**, limité à ce dépôt, avec **Issues : Read and write**.
3. Sur le site concerné, ouvrez les réglages Commyweb. Renseignez le dépôt et votre jeton, puis **Enregistrer**.
4. Utilisez **Partager** pour copier le lien de la page et du projet. Chaque collaborateur renseigne ensuite son propre accès GitHub.

Chaque site peut utiliser un dépôt et un jeton différents. Le bouton **Utiliser le mode local** revient aux annotations locales sans effacer les annotations d’équipe. Les commentaires créés en local restent locaux : ils ne sont pas envoyés automatiquement à un dépôt que vous venez de connecter.

**Le lien ne transmet aucun jeton et n’accorde aucun droit.** Les accès et révocations se gèrent dans GitHub. Un jeton GitHub donne les droits configurés sur le dépôt ; il ne permet pas de garantir un accès limité à une seule URL. Les anciennes invitations contenant un jeton sont reconnues pour sélectionner le dépôt, mais leur jeton est ignoré.

## Stockage et synchronisation

Les commentaires sont d’abord enregistrés dans `chrome.storage.local`. Les discussions d’équipe sont ensuite stockées dans les Issues du dépôt choisi. Les réponses et coordonnées sont sérialisées dans le corps de l’Issue ; résoudre une discussion ferme l’Issue.

Les jetons restent dans le stockage local de l’extension. Les préférences synchronisées par Chrome sont nettoyées de leurs jetons. Un message distingue un enregistrement local d’un partage réussi. Une modification non synchronisée reste en attente et sera réessayée lors des prochains rafraîchissements.

Les pages visibles se rafraîchissent toutes les 15 secondes ; les changements effectués dans l’extension sont aussi signalés aux onglets ouverts. Aucun rafraîchissement réseau périodique n’est lancé pour un onglet masqué. Les pages internes du navigateur et les pages qui interdisent les extensions ne sont pas annotables.

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
```

Les essais navigateur chargent réellement l’extension dans un profil Chromium temporaire. Ils ne touchent pas au profil courant et n’accèdent pas à un compte GitHub réel. Les réponses de l’API GitHub sont simulées dans les tests de synchronisation.

Les archives se trouvent dans `release/`. Il existe désormais une seule édition ; les noms `commyweb-admin.zip` et `commyweb-user.zip` sont conservés comme alias de téléchargement. Le code source se trouve dans `commyweb-source-v*.zip`.

## Limites connues

Les mises à jour d’une même Issue par plusieurs ordinateurs exactement au même moment ne sont pas transactionnelles. Commyweb relit la discussion avant écriture et fusionne les réponses, mais GitHub ne fournit pas de transaction atomique pour ce modèle. Pour des droits par page ou des invitations sans compte GitHub, il faudrait un service d’authentification distinct.

La popup est en français ; les commandes des discussions sur la page utilisent les traductions Chrome françaises ou anglaises. Les routes stockées uniquement dans le fragment d’URL partagent actuellement les annotations d’une même URL normalisée.

Licence MIT.

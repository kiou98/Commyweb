<p align="center">
  <img src="icons/logotype.png" alt="Commyweb" width="360" />
</p>

<p align="center">
  <strong>Extension Chrome collaborative et open-source pour commenter n'importe quel site web façon Figma (sans aucune base de données).</strong>
</p>

<p align="center">
  <a href="https://github.com/kiou98/Commyweb/releases"><img src="https://img.shields.io/github/v/release/kiou98/Commyweb?color=000000&label=Release" alt="DerniÃ¨re Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-000000.svg" alt="Licence MIT"></a>
  <a href="https://github.com/kiou98/Commyweb/stargazers"><img src="https://img.shields.io/github/stars/kiou98/Commyweb?color=000000" alt="GitHub Stars"></a>
</p>

<p align="center">
  <a href="README.md">🇬🇧 Read in English</a>
</p>

---

Commyweb transforme n'importe quelle page web en un espace de travail collaboratif. Faites un clic droit sur n'importe quel élément pour déposer une pastille noire de commentaire. Collaborez avec votre équipe, répondez dans des fils de discussion et résolvez/archivez les commentaires une fois traités—exactement comme dans **Figma**.

---

## ✨ Fonctionnalités

- 🖱️ **Commentaires au Clic Droit :** Faites un clic droit sur n'importe quel élément du site et sélectionnez *"💬 Ajouter un commentaire Commyweb"* (ou faites <kbd>Alt</kbd> + <kbd>C</kbd>) pour déposer une pastille noire de commentaire.
- 🎯 **Ancrage spatial façon Figma :** Les pastilles restent attachées aux éléments HTML et conservent leur position relative exacte même lors du redimensionnement d'écran et du défilement (scroll).
- 💬 **Fils de discussion imbriqués :** Échangez des réponses chronologiques avec les avatars des auteurs et l'heure relative.
- ✅ **Résoudre & Archiver :** Nettoyez la vue en marquant les commentaires résolus. Basculez à tout moment entre les commentaires actifs et archivés.
- ✉️ **Invitations en 1 clic (Copier-Coller Email HTML & Lien Direct) :** Invitez vos collaborateurs sans configuration de serveur d'envoi. Un clic copie l'email d'invitation HTML préformaté (avec guide d'installation étape par étape) prêt à être collé dans Gmail/Outlook, ou le lien direct pour Slack/Teams.
- 🔒 **Clés d'API Masquées (Bouton Œil) :** Votre jeton GitHub PAT est masqué par défaut (`••••••••`) avec un bouton interactif pour afficher/masquer et un badge d'état clair (Configuré / Non configuré).
- 🎯 **Portée Équipe restreinte (1 Projet & 1 URL) :** Verrouillage strict garantissant que les membres invités ont uniquement accès à la page et au projet concernés.
- 🚫 **Révocation d'accès :** Tout membre autorisé du projet peut révoquer un autre collaborateur directement depuis la popup de l'extension.
- ⚡ **Zéro base de données à gérer (No-DB) :** Fonctionne grâce à l'API GitHub (Issues / Discussions). Aucun serveur ni base de données à configurer, maintenir ou payer. Fonctionne aussi 100 % hors ligne/en local sans compte GitHub.
- 🎨 **Direction Artistique Noir & Blanc :** Design monochrome élégant et haute lisibilité avec la typographie **Satoshi**.
- 🌍 **International & Multilingue (i18n) :** Prise en charge native du français et de l'anglais, adaptable à n'importe quelle langue.
- 🛡️ **Sécurité & Isolation :** Isolation CSS étanche grâce au **Shadow DOM** (aucun conflit avec les styles du site visité), assainissement strict anti-XSS et stockage cloisonné.
- 💸 **100 % Gratuit & Open Source :** Licence MIT.

---

## 🚀 Installation rapide en 30 secondes (sans coder)

1. Téléchargez la dernière version [**commyweb-extension-v1.4.2.zip**](https://github.com/kiou98/Commyweb/releases/latest/download/commyweb-extension-v1.4.2.zip) (ou [**commyweb-extension.zip**](https://github.com/kiou98/Commyweb/releases/latest/download/commyweb-extension.zip)).
2. Décompressez le fichier zip sur votre ordinateur.
3. Ouvrez Google Chrome (ou Brave, Edge, Opera) et accédez à `chrome://extensions/`.
4. Activez l'interrupteur **"Mode développeur"** en haut à droite.
5. Cliquez sur le bouton **"Charger l'extension non empaquetée"** en haut à gauche et sélectionnez le dossier décompressé.

*C'est tout ! L'icône noire Commyweb apparaît immédiatement dans votre barre d'extensions.*

---

## ⌨️ Utilisation

1. Rendez-vous sur n'importe quel site web.
2. Faites un **clic droit** sur n'importe quel élément et choisissez **"💬 Ajouter un commentaire Commyweb"** (ou faites <kbd>Alt</kbd> + <kbd>C</kbd>).
3. Rédigez votre commentaire et cliquez sur **Envoyer** (ou appuyez sur <kbd>Entrée</kbd>). Une pastille noire Commyweb s'affiche à cet endroit exact !
4. Cliquez sur n'importe quelle pastille pour consulter la discussion, répondre ou cliquer sur **Résoudre**.

## 💾 Où sont enregistrés vos messages et commentaires ?

Commyweb adopte une architecture **Zéro Base de Données (No-DB)** axée sur la confidentialité totale :

1. **En local dans votre navigateur (`chrome.storage.local`) :**
   - Tous vos commentaires sont d'abord enregistrés directement sur votre machine.
   - Ils restent disponibles immédiatement, même hors ligne, et **ne sont jamais perdus** lors des redémarrages ou des mises à jour de l'extension.

2. **Dans votre dépôt GitHub privé (Mode collaboratif d'équipe) :**
   - Dès que vous liez votre dépôt privé (ex. `mon-equipe/projet-secret`), chaque discussion est synchronisée sous forme d'**Issue GitHub** sécurisée.
   - Les coordonnées d'ancrage, le texte, l'auteur et les réponses y sont conservés.
   - Résoudre un commentaire dans l'extension ferme automatiquement l'Issue correspondante sur GitHub.

> 🔒 **Garantie de souveraineté :** Aucune base de données tierce, aucun serveur intermédiaire et aucune entreprise externe n'a accès à vos données. Vous restez 100 % propriétaire de vos échanges.

---

## 👥 Qui a besoin d'un compte ? (Zéro contrainte pour l'équipe)

| Rôle | Besoin de compte GitHub ? | Rôle dans le projet |
| :--- | :---: | :--- |
| **👑 Vous (Créateur du projet)** | **Oui** (1 jeton PAT pour lier votre dépôt privé) | Crée le dépôt privé gratuit où sont enregistrés les commentaires de l'équipe. |
| **🚀 Vos Invités / Collaborateurs** | ❌ **AUCUN** | Ils reçoivent votre invitation, installent l'extension, et commentent directement comme sur Figma ! |

> 🔒 **Zéro friction :** Vos clients, collègues ou partenaires n'ont **aucun compte, aucun mot de passe, ni aucune inscription à créer**.

---

## 🎯 Comment fonctionne le verrouillage : 1 Projet & 1 URL par Équipe

Pour garantir que vos échanges restent rigoureusement cloisonnés par équipe et par site web :

1. **Portée Projet globale (Dépôt GitHub) :**
   - Dans Commyweb, **1 Projet = 1 Dépôt GitHub** (`owner/repo`).
   - Si vous avez plusieurs projets clients distincts (ex. *Client A* et *Client B*), créez simplement un dépôt GitHub pour chacun (ex. `mon-agence/client-a` et `mon-agence/client-b`). Leurs discussions restent 100 % hermétiques.
2. **Portée Page locale (URL ciblée) :**
   - Chaque URL de page web est automatiquement normalisée et hachée (`urlHash`).
   - Les codes d'accès des membres (`authCode`) et les fils de discussion sont indexés sur cette URL exacte (`commyweb_policy_<urlHash>`).
   - Quand vous invitez un membre depuis une page, il n'a accès **qu'à cette page exacte et à ce projet**.

---

## 🤝 Configuration collaborative d'équipe pas-à-pas (Backend GitHub sans BDD)

Pour partager vos commentaires en équipe sans héberger de serveur :

1. **Créer votre dépôt GitHub de projet :**
   - Allez sur [github.com/new](https://github.com/new).
   - Donnez-lui un nom (ex. `commyweb-projet-a`).
   - Définissez-le comme **Privé** pour protéger vos retours.
2. **Générer un Personal Access Token (PAT) :**
   - Rendez-vous sur [GitHub Fine-grained tokens](https://github.com/settings/tokens?type=beta).
   - *Token name :* `Commyweb Extension`
   - *Repository access :* Sélectionnez **Only select repositories** et choisissez votre dépôt de projet.
   - *Repository permissions :* Dans la section **Issues**, cochez **Access: Read and write** (*Metadata: Read-only* s'active automatiquement).
   - Cliquez sur **Generate token** et copiez le jeton `github_pat_...`.
   *(Alternative Token Classic : cochez simplement le scope `repo`)*.
3. **Configurer l'extension Commyweb :**
   - Ouvrez la popup, cliquez sur **Paramètres ⚙️**.
   - Collez votre jeton dans **GitHub Token** (masqué par des ronds avec toggle œil).
   - Renseignez le nom du dépôt dans **Dépôt de stockage** (`propriétaire/nom-du-repo`).
   - Saisissez votre adresse email (expéditeur).
4. **Sauvegarde automatique :** Vos paramètres se sauvegardent en temps réel et vos commentaires se synchronisent immédiatement avec votre équipe !

---

## 🛠️ Développement local

```bash
# Cloner le dépôt
git clone https://github.com/kiou98/Commyweb.git
cd Commyweb

# Installer les dépendances
npm install

# Compiler en continu pour le dev
npm run dev

# Compiler la version de production
npm run build

# Générer l'archive zip de distribution
npm run package
```

Chargez ensuite le dossier `dist` généré dans `chrome://extensions/`.

---

## 📄 Licence

Licence MIT. Libre d'utilisation, de modification et de redistribution.

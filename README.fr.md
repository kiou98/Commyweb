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

- 🖱️ **Commentaires au Clic Droit :** Faites un clic droit sur n'importe quel élément du site et sélectionnez *"💬 Ajouter un commentaire Commyweb"* pour déposer une pastille noire de commentaire.
- 🎯 **Ancrage spatial façon Figma :** Les pastilles restent attachées aux éléments HTML et conservent leur position relative exacte même lors du redimensionnement d'écran et du défilement (scroll).
- 💬 **Fils de discussion imbriqués :** Échangez des réponses chronologiques avec les avatars des auteurs et l'heure relative.
- ✅ **Résoudre & Archiver :** Nettoyez la vue en marquant les commentaires résolus. Basculez à tout moment entre les commentaires actifs et archivés.
- ✉️ **Invitations Email & Lien Magique :** Invitez vos collaborateurs par email. Un simple clic sur le lien magique dans l'email les autorise automatiquement sur le projet.
- 🚫 **Révocation d'accès :** Tout membre autorisé du projet peut révoquer un autre collaborateur directement depuis la popup de l'extension.
- ⚡ **Zéro base de données à gérer (No-DB) :** Fonctionne grâce à l'API GitHub (Issues / Discussions). Aucun serveur ni base de données à configurer, maintenir ou payer. Fonctionne aussi 100 % hors ligne/en local sans compte GitHub.
- 🎨 **Direction Artistique Noir & Blanc :** Design monochrome élégant et haute lisibilité avec la typographie **Satoshi**.
- 🌍 **International & Multilingue (i18n) :** Prise en charge native du français et de l'anglais, adaptable à n'importe quelle langue.
- 🛡️ **Sécurité & Isolation :** Isolation CSS étanche grâce au **Shadow DOM** (aucun conflit avec les styles du site visité), assainissement strict anti-XSS et stockage cloisonné.
- 💸 **100 % Gratuit & Open Source :** Licence MIT.

---

## 🚀 Installation rapide en 30 secondes (sans coder)

1. Téléchargez la dernière version `commyweb-extension.zip` depuis l'onglet [**Releases**](https://github.com/kiou98/Commyweb/releases).
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

---

## 🤝 Configuration collaborative d'équipe (Backend GitHub sans BDD)

Pour partager vos commentaires en équipe sans héberger de serveur :

1. Créez un dépôt GitHub (ex: `kiou98/Commyweb`). Il peut être **public** ou **privé**.
2. Générez un [Personal Access Token (Fine-grained)](https://github.com/settings/tokens) avec la permission `Issues: Read & Write` sur ce dépôt.
3. Ouvrez la popup Commyweb, cliquez sur **Paramètres ⚙️** et saisissez :
   - **GitHub Token :** votre jeton PAT
   - **Dépôt de stockage :** `kiou98/Commyweb`
4. Cliquez sur **Enregistrer les paramètres**. Tous les commentaires de n'importe quel site se synchronisent automatiquement entre les membres de l'équipe !

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

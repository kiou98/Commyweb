# Commyweb 💬

> **Extension Chrome collaborative et open-source pour commenter n'importe quel site web façon Figma (sans aucune base de données).**

[🇬🇧 Read in English](README.md)

Commyweb transforme n'importe quelle page web en un espace de travail collaboratif. Appuyez sur <kbd>Alt</kbd> + <kbd>C</kbd>, cliquez sur un élément du site pour déposer une pastille de commentaire. Collaborez avec votre équipe, répondez dans des fils de discussion et résolvez/archivez les commentaires une fois traités—exactement comme dans **Figma**.

---

## ✨ Fonctionnalités

- 🎯 **Ancrage spatial façon Figma :** Les pastilles restent attachées aux éléments HTML et conservent leur position relative exacte même lors du redimensionnement d'écran et du défilement (scroll).
- 💬 **Fils de discussion imbriqués :** Échangez des réponses chronologiques avec les avatars des auteurs et l'heure relative.
- ✅ **Résoudre & Archiver :** Nettoyez la vue en marquant les commentaires résolus. Basculez à tout moment entre les commentaires actifs et archivés.
- ⚡ **Zéro base de données à gérer (No-DB) :** Fonctionne grâce à l'API GitHub (Issues / Discussions). Aucun serveur ni base de données à configurer, maintenir ou payer. Fonctionne aussi 100 % hors ligne/en local sans compte GitHub.
- 🌍 **International & Multilingue (i18n) :** Prise en charge native du français et de l'anglais, adaptable à n'importe quelle langue via le standard `_locales` de Chrome.
- 🛡️ **Sécurité & Isolation :** Isolation CSS étanche grâce au **Shadow DOM** (aucun conflit avec les styles du site visité), assainissement strict anti-XSS et stockage cloisonné.
- 💸 **100 % Gratuit & Open Source :** Licence MIT.

---

## 🚀 Installation rapide en 30 secondes (sans coder)

1. Téléchargez la dernière version `commyweb-extension.zip` depuis l'onglet [**Releases**](https://github.com/your-username/commyweb/releases).
2. Décompressez le fichier zip sur votre ordinateur.
3. Ouvrez Google Chrome (ou Brave, Edge, Opera) et accédez à `chrome://extensions/`.
4. Activez l'interrupteur **"Mode développeur"** en haut à droite.
5. Cliquez sur le bouton **"Charger l'extension non empaquetée"** en haut à gauche et sélectionnez le dossier décompressé.

*C'est tout ! L'icône Commyweb apparaît immédiatement dans votre barre d'extensions.*

---

## ⌨️ Utilisation

1. Rendez-vous sur n'importe quel site web.
2. Appuyez sur <kbd>Alt</kbd> + <kbd>C</kbd> (ou cliquez sur l'icône de l'extension et activez le **Mode commentaire**).
3. Cliquez n'importe où sur la page pour déposer une pastille.
4. Rédigez votre commentaire et cliquez sur **Envoyer** (ou appuyez sur <kbd>Entrée</kbd>).
5. Cliquez sur une pastille pour consulter la discussion, répondre ou cliquer sur **Résoudre**.

---

## 🤝 Configuration collaborative d'équipe (Backend GitHub sans BDD)

Pour partager vos commentaires en équipe sans héberger de serveur :

1. Créez un dépôt GitHub (ex: `votre-equipe/feedback-sites`). Il peut être **public** ou **privé**.
2. Générez un [Personal Access Token (Fine-grained)](https://github.com/settings/tokens) avec la permission `Issues: Read & Write` sur ce dépôt.
3. Ouvrez la popup Commyweb, cliquez sur **Paramètres ⚙️** et saisissez :
   - **GitHub Token :** votre jeton PAT
   - **Dépôt de stockage :** `votre-equipe/feedback-sites`
4. Cliquez sur **Enregistrer les paramètres**. Tous les commentaires de n'importe quel site se synchronisent automatiquement entre les membres de l'équipe !

---

## 🛠️ Développement local

```bash
# Cloner le dépôt
git clone https://github.com/your-username/commyweb.git
cd commyweb

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

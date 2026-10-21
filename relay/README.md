# Relais temps réel Commyweb

Ce petit serveur transmet les signaux de changement entre installations Commyweb. Les commentaires et les droits restent dans GitHub. Le relais ne reçoit ni jeton GitHub, ni texte de commentaire, ni nom de dépôt. Il n’a pas besoin de base de données.

Il faut un hébergement qui maintient un serveur Node.js ou un conteneur Docker en fonctionnement et accepte les connexions WebSocket. Les fonctions courtes de Netlify ne remplacent pas ce relais.

## Installer une seule fois pour l’équipe

1. Déployez le dossier `relay/` avec son `Dockerfile`, ou avec Node.js 20+.
2. Configurez le service pour écouter sur `0.0.0.0` et le port fourni par l’hébergeur (`HOST` et `PORT`).
3. Activez HTTPS/TLS avec la terminaison TLS de l’hébergeur ou un reverse proxy. La route `/sync` doit autoriser la mise à niveau WebSocket. La route `/health` renvoie `{"ok":true}` pour les contrôles de disponibilité.
4. Dans les réglages du projet Commyweb, ouvrez **Temps réel · configuration du responsable**. Collez `wss://votre-domaine/sync`, puis **Vérifier et connecter**.
5. Vérifiez que Commyweb affiche **Temps réel actif**. Utilisez **Inviter** pour préparer un nouvel email : la configuration du relais est incluse dans le lien.

Les collaborateurs ouvrent le lien et connectent leur propre jeton GitHub. Ils n’ont ni adresse de relais ni canal à saisir. Les invitations créées avant la configuration du relais doivent être remplacées par un nouveau lien.

## Avec Docker

Depuis ce dossier :

```sh
docker build -t commyweb-relay .
docker run --rm -p 3000:3000 commyweb-relay
```

L’hébergeur doit exposer ce service en `wss://` pour un usage entre ordinateurs. Le conteneur définit `HOST=0.0.0.0` et `PORT=3000` ; le port peut être remplacé par la plateforme.

## Avec Node.js

```sh
npm ci --omit=dev
npm start
```

Sans variables d’environnement, le service écoute uniquement sur `127.0.0.1:3000` pour des essais locaux. Dans l’extension, utilisez alors `ws://127.0.0.1:3000/sync`. Les adresses non chiffrées sont refusées hors localhost.

Depuis le dépôt complet, `npm ci` puis `npm run relay` permettent aussi de démarrer le relais de développement.

## Fonctionnement

L’extension génère un identifiant de canal aléatoire pour le projet et l’inclut dans ses invitations. Le client s’abonne par message WebSocket, sans placer cet identifiant dans l’URL. Une fois une modification confirmée par GitHub, l’extension émet un signal ; les autres clients du même canal relisent leur projet GitHub immédiatement.

Le client échange un signal de présence toutes les 20 secondes, détecte les connexions muettes et se reconnecte avec un délai progressif. Après reconnexion, il relit les commentaires manqués. Le rafraîchissement GitHub toutes les 15 secondes reste un filet de sécurité, notamment pour les modifications faites directement dans GitHub.

Le statut **Temps réel actif** confirme la connexion au relais. Le délai d’affichage d’une modification dépend aussi de la disponibilité et de la propagation de l’API GitHub. Une panne du relais ne fait pas perdre les commentaires ; ils restent sur GitHub ou en attente sur l’appareil.

## Déploiement et limites

- Utilisez une seule instance du relais. Plusieurs instances indépendantes ne partagent pas leurs abonnements ; une répartition sans bus commun peut séparer les collaborateurs.
- Si l’hébergement met le service en veille, les clients devront attendre son réveil avant de retrouver le temps réel.
- Les canaux sont des capacités d’accès aux notifications. Toute personne disposant du lien peut provoquer un rafraîchissement du canal, mais ne reçoit pas les commentaires sans ses propres droits GitHub. Ne publiez pas les invitations à grande échelle.
- Le relais limite la taille des messages et le nombre de connexions. Pour une exposition publique importante, utilisez aussi les limites de trafic de votre hébergeur.
- Le relais n’est ni une authentification GitHub, ni un service d’envoi d’emails, ni une protection contre les écritures concurrentes du corps d’une même Issue.

Le protocole accepte les messages `subscribe`, `ping` et `changed`. Il répond par `ready`, `pong` et `changed`. Les propriétés supplémentaires d’un signal ne sont jamais retransmises.

Ce dossier est livré prêt à déployer. Un relais testé sur localhost n’est pas automatiquement accessible à votre équipe : il faut le déployer et renseigner son URL publique.

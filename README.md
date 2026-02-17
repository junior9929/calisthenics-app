# Application Calisthenics — Phase 1

Application web de suivi d'entraînement calisthenics, développée en HTML/JavaScript/CSS vanilla avec une approche offline-first utilisant localStorage.

## 📋 Fonctionnalités principales

- **Test initial** : Évaluation de ton niveau actuel sur chaque exercice fondamental
- **Séances en circuit** : Entraînements personnalisés basés sur tes niveaux actuels
- **Progression automatique** : Propositions de montée de niveau après validation des objectifs
- **Historique** : Suivi de toutes tes séances avec statistiques et meilleurs performances
- **Export/Import** : Sauvegarde et restauration de ta progression
- **Mode offline** : Fonctionne entièrement sans connexion internet
- **Échauffement guidé** : Routines d'échauffement intégrées avant chaque séance

## 🎯 Exercices fondamentaux (Phase 1)

- Tractions (Pull-ups)
- Pompes (Push-ups)
- Pistols (Squats sur une jambe)
- Gainage (Plank)
- Dips
- L-sit

## 🚀 Comment lancer le projet

L'application nécessite un serveur HTTP local pour fonctionner correctement (à cause des modules ES6 et du chargement de fichiers JSON).

### Option 1 : Avec Node.js et npx

```bash
npx serve .
```

Puis ouvre http://localhost:3000 dans ton navigateur.

### Option 2 : Avec Python

```bash
# Python 3
python -m http.server 8000

# Python 2
python -m SimpleHTTPServer 8000
```

Puis ouvre http://localhost:8000 dans ton navigateur.

### Option 3 : Avec PHP

```bash
php -S localhost:8000
```

Puis ouvre http://localhost:8000 dans ton navigateur.

## 📁 Structure des fichiers

```
calisthenics-app/
├── index.html              # Point d'entrée HTML
├── styles.css              # Styles CSS
├── programme.json          # Définition du programme d'entraînement
├── progress.json           # Fichier de progression initial (template)
├── js/                     # Modules JavaScript
│   ├── app.js              # Point d'entrée principal
│   ├── state.js            # Gestion de l'état global
│   ├── utils.js            # Fonctions utilitaires
│   ├── audio.js            # Web Audio API (bips)
│   ├── storage.js          # Persistance localStorage
│   ├── program.js          # Accès aux données du programme
│   ├── circuit.js          # Génération du circuit d'entraînement
│   ├── validation.js       # Validation et montée de niveau
│   ├── entry-fields.js     # Champs de saisie
│   ├── timer.js            # Timers et overlay de repos
│   ├── swipe.js            # Gestion des gestes tactiles
│   ├── export-import.js    # Export/Import de progression
│   ├── workout.js          # Flow de séance d'entraînement
│   ├── test-flow.js        # Flow de test initial/retest
│   ├── warmup.js           # Échauffement
│   ├── dashboard.js        # Dashboard principal
│   ├── history.js          # Historique et résumé
│   └── session-setup.js    # Configuration de séance
├── README.md               # Ce fichier
├── .gitignore             # Fichiers à ignorer par Git
└── package.json           # Configuration npm
```

## 🛠️ Technologies utilisées

- **HTML5** : Structure de l'application
- **CSS3** : Styles avec variables CSS et gradients
- **JavaScript ES6+** : Modules natifs, async/await
- **Web Audio API** : Bips de compte à rebours
- **localStorage** : Persistance des données côté client
- **JSON** : Stockage des données de programme et de progression

## 💾 Sauvegarde de la progression

Ta progression est automatiquement sauvegardée dans le localStorage de ton navigateur. Pour sauvegarder sur un autre appareil ou faire une copie de secours :

1. Va dans l'onglet Dashboard
2. Clique sur "Historique"
3. Utilise la fonction "Export" pour télécharger un fichier JSON
4. Pour restaurer : utilise la fonction "Import" et sélectionne ton fichier JSON

## 📱 Compatibilité

L'application est optimisée pour :
- Navigateurs modernes (Chrome, Firefox, Safari, Edge)
- Mobile et tablette (responsive design)
- Mode offline (après le premier chargement)

## 🏃 Utilisation

1. **Premier lancement** : Fais le test initial pour établir tes niveaux de départ
2. **Configuration** : Choisis ton focus (Pull, Push, ou Tout) et sélectionne les exercices
3. **Échauffement** : Suis la routine d'échauffement recommandée
4. **Entraînement** : Réalise 4 tours de ton circuit personnalisé
5. **Progression** : Valide les objectifs pour monter de niveau
6. **Suivi** : Consulte l'historique pour suivre tes progrès

## 📝 Notes

- L'application ne collecte aucune donnée personnelle
- Toutes les données restent sur ton appareil
- Les bips sonores peuvent être désactivés dans les réglages
- Les repos entre exercices et entre tours sont personnalisables

## 🤝 Contribution

Ce projet est un outil personnel d'entraînement. Les suggestions d'amélioration sont les bienvenues !

## 📄 Licence

Projet personnel à but éducatif et d'entraînement.

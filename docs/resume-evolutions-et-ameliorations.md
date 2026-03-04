# Résumé des dernières évolutions & pistes d'amélioration

## Dernières évolutions (récentes)

### 1) Overlay de repos enrichi avec visibilité sur l'exercice suivant
- L'overlay de repos affiche maintenant explicitement le prochain exercice (`Prochain exercice : ...`), ce qui réduit les frictions pendant les transitions de circuit.
- Le timer de repos conserve un contrôle utilisateur clair (masquer / passer), tout en centralisant l'avancement via le flux existant.
- Les bips de compte à rebours en fin de repos restent présents (3-2-1-GO), ce qui améliore le rythme de séance.

### 2) Fiabilisation du timer d'échauffement
- Le timer d'échauffement a été consolidé avec une logique de bips de décompte cohérente jusqu'à 0.
- L'initialisation audio est explicitement gérée sur geste utilisateur, utile notamment pour iOS/Safari.
- Le comportement “manuel, sans auto-avance” de l'étape d'échauffement est préservé, ce qui garde l'utilisateur maître du pacing.

### 3) Améliorations de saisie sur les blocs de maintien (hold)
- Les champs de saisie “hold” ont été améliorés pour mieux pré-remplir/mettre en pause la valeur, limitant les erreurs de saisie et accélérant la validation d'étape.

### 4) Stabilisation structurelle déjà engagée avant ces changements
- Le projet a déjà mené une refactorisation vers des modules ES6 spécialisés (`timer`, `warmup`, `workout`, `state`, etc.), base saine pour continuer à scaler.
- Plusieurs correctifs de robustesse (race conditions async, persistance, imports) ont été traités récemment.

---

## Proposition d'améliorations (priorisées)

## Priorité 1 — Fiabilité et qualité perçue (impact fort, effort modéré)
1. **Ajouter des tests automatiques ciblés sur les flows critiques**
   - Cibler en premier : timer de repos, timer d'échauffement, validation de fin d'exercice et progression de niveau.
   - Introduire des tests unitaires sur la logique pure + quelques tests E2E (Playwright) sur les parcours clés.

2. **Tracer les erreurs runtime côté client (sans backend complexe)**
   - Ajouter un “error boundary” léger JS (`window.onerror`, `unhandledrejection`) avec journal local exportable.
   - Permettre à l'utilisateur d'exporter un rapport diagnostic dans l'écran historique.

3. **Durcir la stratégie de migration de données localStorage**
   - Versionner explicitement le schéma de progression.
   - Implémenter des migrations atomiques (vN -> vN+1) avec fallback et rollback simple.

## Priorité 2 — Expérience utilisateur (impact fort, effort modéré)
4. **Ajouter un “mode séance rapide” configurable**
   - Préréglages de repos (court/standard/long), volume sonore et vibrations.
   - Un seul écran “démarrer en 1 clic” pour les utilisateurs réguliers.

5. **Rendre la prochaine action toujours évidente**
   - Uniformiser les CTA principaux (`Marquer fait`, `Continuer`, `Terminer`) et l'ordre des boutons selon le contexte.
   - Ajouter de micro-indications de progression (ex : “tour 2/4 · exo 3/6”).

6. **Accessibilité mobile renforcée**
   - Vérifier contrastes, zones tactiles minimales, labels ARIA pour les contrôles timer.
   - Ajouter une option de taille de texte/espacement pour usage en entraînement réel.

## Priorité 3 — Valeur produit et engagement (impact moyen/fort)
7. **Boucle de progression plus explicite**
   - Afficher des objectifs de séance contextualisés (“il reste 2 validations pour passer niveau X”).
   - Ajouter un mini-récap “avant/après” en fin de séance.

8. **Insights de progression dans le dashboard**
   - Tendances 7/30 jours (constance, volume total, temps sous tension estimé).
   - Détection simple de stagnation et suggestion de deload/réglage repos.

9. **Planification hebdomadaire légère**
   - Permettre de définir 2 à 4 créneaux hebdomadaires avec rappels locaux (si possible via navigateur/PWA).

## Priorité 4 — Plateforme et maintenabilité
10. **PWA complète (manifest + service worker versionné)**
    - Objectif : démarrage plus rapide, expérience installable, cache maîtrisé.
    - Important : stratégie de cache prudente pour les fichiers JSON de progression.

11. **Observabilité locale et métriques anonymes optionnelles**
    - Sans compromettre le mode offline-first : stocker des métriques locales consultables par l'utilisateur.
    - Option d'export des métriques pour auto-analyse.

12. **Standardiser conventions et documentation technique**
    - Définir conventions de modules (naming, événements, cycle de vie timers, toasts).
    - Ajouter une section “architecture decision records” légère dans `docs/`.

---

## Plan d'exécution recommandé (6 semaines)

- **S1-S2** : tests critiques + migration localStorage + journal d'erreurs exportable.
- **S3-S4** : UX séance rapide + CTA/progression unifiée + accessibilité mobile.
- **S5** : insights dashboard + fin de séance enrichie.
- **S6** : PWA & nettoyage architecture/documentation.

Ce plan vise d'abord la fiabilité perçue en séance (ce qui impacte immédiatement l'usage), puis l'engagement long terme via les insights et la progression visible.

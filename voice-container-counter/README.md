# voice-container-counter

POC : dictée vocale → parsing simple → correction manuelle → agrégat des totaux par article dans un contenant.

## Démarrage (Docker)

À la racine :

```bash
docker compose up --build
```

## Accès

Frontend :
- http://localhost:4317

Backend (si besoin) :
- http://localhost:4318/health

## Notes

- La reconnaissance vocale est faite côté navigateur via Web Speech API (react-speech-recognition).
- Sur "localhost", c’est généralement accepté sans HTTPS, mais le support dépend du navigateur (Chrome/Edge recommandés).
- Le frontend appelle le backend via un proxy Vite :
  - le frontend fait des requêtes sur /api/...
  - Vite proxy vers http://backend:4318 (hostname Docker)
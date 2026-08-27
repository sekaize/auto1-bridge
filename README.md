# Auto1 — Pont dépôt photos marchand (100% gratuit, sans Google Cloud)

Le marchand ouvre un **lien public** (avec son lead), dépose ses photos/documents — **sans aucun compte**.
Le serveur les garde quelques minutes ; ton **script Apps Script auto1** vient les récupérer et les range
dans le **Drive auto1**, dossier au nom du lead. Fonctionne pour **tous les formats, HEIC compris**.

Aucune clé Google, aucun compte de service, aucun Google Cloud — on réutilise l'identité qui a déjà le
droit d'écrire dans le Drive auto1 : ton propre script.

```
Marchand → [page publique gratuite] → serveur (garde ~minutes)
                                          ↑ récupère toutes les 5 min
                          Ton Apps Script auto1 → Drive auto1 / <LEAD>/
```

---

## 1) Déployer la page (hébergement gratuit — Render)

1. Crée un compte gratuit sur https://render.com (connexion Google possible).
2. Mets ce dossier dans un dépôt GitHub (ou utilise « Deploy from a public Git repo »).
3. Render → **New → Web Service** → choisis le dépôt.
   - **Build command** : `npm install`
   - **Start command** : `npm start`
   - **Instance type** : **Free**
4. Onglet **Environment** → **Add Environment Variable**, ajoute :

| Clé | Valeur |
|---|---|
| `LINK_SECRET` | une longue chaîne aléatoire secrète (invente-la) |
| `PULL_KEY` | une autre chaîne secrète (ton script la présentera pour récupérer) |
| `ADMIN_KEY` | une 3e chaîne secrète (protège le générateur de liens) |
| `MAX_MB` | `40` (optionnel) |

5. **Create Web Service**. Au bout d'1-2 min tu obtiens une URL type
   `https://auto1-bridge.onrender.com`. Garde-la.

> Astuce : comme ton script vient chercher les fichiers toutes les 5 min, il maintient le
> serveur gratuit « éveillé » — les fichiers ne restent donc jamais bloqués.

## 2) Brancher ton Apps Script auto1

1. Ouvre ton projet **« Full Refund - Intake Photos »** dans Apps Script.
2. Colle le contenu de **`pullBridge.gs`** (fourni) à la fin de `Code.gs` (ou dans un nouveau fichier).
3. **Paramètres du projet → Propriétés du script** → ajoute :
   - `BRIDGE_URL` = l'URL Render (ex. `https://auto1-bridge.onrender.com`)
   - `PULL_KEY` = **exactement la même valeur** que côté Render
4. Sélectionne la fonction **`installBridgeTrigger`** → **Exécuter** (une fois).
   → un déclencheur récupère les dépôts toutes les 5 minutes et les range dans le Drive.

## 3) Générer un lien marchand

- Par le serveur : `https://auto1-bridge.onrender.com/link?lead=KN25788&key=TON_ADMIN_KEY`
  → renvoie l'URL à envoyer au marchand.
- En local : `LINK_SECRET="…" BASE_URL="https://auto1-bridge.onrender.com" node gen-link.js KN25788`

Le lien ressemble à : `https://auto1-bridge.onrender.com/u?lead=KN25788&t=xxxxxxxx`
Tu le colles dans ton mail de procédure ; le marchand l'ouvre sur son téléphone, ajoute ses
photos, appuie sur **Envoyer** → quelques minutes plus tard tout est dans le Drive, dossier `KN25788`.

## Sécurité

- Le marchand ne fait que **pousser** des fichiers : il ne voit rien du Drive.
- Un lien n'est valide que pour **son lead** et seulement si tu l'as généré (signature `LINK_SECRET`).
- La récupération est protégée par `PULL_KEY` ; le générateur de liens par `ADMIN_KEY`.
- Change `LINK_SECRET` pour invalider **tous** les liens d'un coup.

## Détails techniques

- `GET /u?lead=&t=` : page marchand. `POST /upload` : dépôt (multipart).
- `GET /pending?key=` : liste des fichiers en attente. `GET /file/:id?key=` : contenu.
  `POST /done {ids}` : suppression après récupération. (réservés à ton Apps Script via `PULL_KEY`)
- Stockage temporaire sur le disque de l'hébergeur, effacé dès que ton script a récupéré.

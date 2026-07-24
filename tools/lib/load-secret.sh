# load-secret.sh — chargement de secrets locaux, à sourcer par les scripts de
# tools/. Un secret vit dans un fichier plat sous $PR1V8TE_DIR (défaut
# ~/.pr1v8te), un par ligne unique, jamais dans le dépôt git.
#
# Priorité : variable d'environnement déjà exportée > fichier local > saisie
# interactive masquée (avec proposition d'enregistrement pour la prochaine
# fois). N'écrit JAMAIS le secret sur stdout ni dans un log — uniquement en
# valeur de retour de fonction (capturée par appel en $(...)).
#
# Usage : TOKEN="${TOKEN:-$(load_secret nom-fichier "Message affiché")}"

# Les secrets vivent dans un SOUS-dossier : la racine ~/.pr1v8te peut contenir
# les scripts eux-mêmes (et d'autres clés), qu'il ne faut ni lister comme des
# secrets ni passer en chmod 600 — ce qui les rendrait non exécutables.
PR1V8TE_DIR="${PR1V8TE_DIR:-$HOME/.pr1v8te/secrets}"

load_secret() {
  local name="$1" prompt="$2"
  local file="${PR1V8TE_DIR}/${name}"

  if [ -f "$file" ]; then
    local perms
    perms=$(stat -c '%a' "$file" 2>/dev/null || stat -f '%Lp' "$file" 2>/dev/null || echo "")
    if [ -n "$perms" ] && [ "$perms" != "600" ]; then
      echo "⚠ $file : permissions ${perms} (600 attendu) — corrige avec : chmod 600 $file" >&2
    fi
    local val
    val=$(tr -d '\n' < "$file")
    if [ -z "$val" ]; then
      echo "⚠ $file existe mais est vide — saisie manuelle." >&2
    else
      printf '%s' "$val"
      return 0
    fi
  fi

  local val
  read -rsp "${prompt} : " val
  echo >&2
  if [ -z "$val" ]; then
    echo "❌ valeur vide, abandon." >&2
    return 1
  fi
  local save
  read -rp "Enregistrer dans ${file} pour la prochaine fois ? [o/N] " save
  if [ "$save" = "o" ] || [ "$save" = "O" ]; then
    mkdir -p "$PR1V8TE_DIR"
    chmod 700 "$PR1V8TE_DIR"
    printf '%s' "$val" > "$file"
    chmod 600 "$file"
    echo "→ enregistré dans ${file} (chmod 600)" >&2
  fi
  printf '%s' "$val"
}

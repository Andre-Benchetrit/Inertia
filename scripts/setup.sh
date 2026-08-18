#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js 20.9 ou superior e npm são necessários."
  echo "Instale o Node.js em https://nodejs.org/ e execute este script novamente."
  exit 1
fi

if ! node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 20 || (major === 20 && minor >= 9) ? 0 : 1)"; then
  echo "Node.js 20.9 ou superior é necessário. Versão encontrada: $(node --version)"
  exit 1
fi

echo "Instalando dependências com npm ci..."
npm ci

if [ ! -f ".env.local" ]; then
  cp ".env.example" ".env.local"
  echo "Arquivo .env.local criado a partir de .env.example."
  echo "Preencha as variáveis do Supabase antes de iniciar o projeto."
fi

echo "Instalação concluída."
echo "Próximos comandos:"
echo "  npm run dev"
echo "  npm run lint"
echo "  npm run build"

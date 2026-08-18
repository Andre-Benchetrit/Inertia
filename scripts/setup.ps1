$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

function Assert-CommandExists {
  param([string]$CommandName)

  if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    throw "O comando '$CommandName' não foi encontrado. Instale Node.js 20.9 ou superior e tente novamente."
  }
}

Assert-CommandExists "node"
Assert-CommandExists "npm"

$nodeVersion = node --version
$nodeVersionValue = [version]($nodeVersion -replace "^v", "")

if ($nodeVersionValue -lt [version]"20.9.0") {
  throw "Node.js 20.9 ou superior é necessário. Versão encontrada: $nodeVersion"
}

Write-Host "Instalando dependências com npm ci..." -ForegroundColor Cyan
npm ci
if ($LASTEXITCODE -ne 0) {
  throw "A instalação das dependências falhou. Feche processos que estejam usando node_modules e tente novamente."
}

if (-not (Test-Path ".env.local")) {
  Copy-Item ".env.example" ".env.local"
  Write-Host "Arquivo .env.local criado a partir de .env.example." -ForegroundColor Yellow
  Write-Host "Preencha as variáveis do Supabase antes de iniciar o projeto." -ForegroundColor Yellow
}

Write-Host "Instalação concluída." -ForegroundColor Green
Write-Host "Próximos comandos:" -ForegroundColor Cyan
Write-Host "  npm run dev"
Write-Host "  npm run lint"
Write-Host "  npm run build"

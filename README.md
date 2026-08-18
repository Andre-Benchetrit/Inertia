# Inertia

**Inertia** é uma plataforma colaborativa para escrita de ficção. A experiência principal é inspirada em uma conversa de WhatsApp: dois autores escrevem juntos, organizando as mensagens por **livro** e **capítulo**, sem transformar o projeto em um editor tradicional.

O projeto também possui uma camada editorial opcional com Ollama local. A inteligência artificial lê a Fonte, compila um Manuscrito em Markdown com estilo próximo ao Wattpad e produz Sugestões editoriais que devem ser aceitas ou rejeitadas manualmente pelos autores.

> A Fonte nunca é alterada pela inteligência artificial. O conteúdo original dos autores permanece preservado.

## Funcionalidades

- Cadastro, login e sessão usando Supabase Auth.
- Criação de livros e capítulos.
- Colaboração entre dois autores por meio de links de convite.
- Chat separado por capítulo, com mensagens ajustadas ao conteúdo como em um aplicativo de conversa.
- Classificação das mensagens como **História** ou **Comentário**.
- Edição e exclusão lógica das próprias mensagens, com possibilidade de recuperação.
- Indicadores de presença online/offline e de digitação.
- Formatação simples no chat, com negrito, itálico e títulos.
- Exportação de backup em JSON.
- Camada **Fonte**, formada pelas mensagens originais.
- Camada **Manuscrito**, compilada e editável.
- Camada **Sugestões**, produzida pela revisão editorial e resolvida manualmente.
- Compilação e revisão opcionais com Ollama local.
- Formatação editorial em Markdown: títulos, negrito, itálico, citações e separadores.
- Exclusão automática de mensagens classificadas como Comentário do conteúdo enviado à IA.
- Limite de uma revisão concluída por versão do Manuscrito.
- Contexto narrativo baseado no título e na descrição do livro.

## Stack

| Camada                   | Tecnologia                                    |
| ------------------------ | --------------------------------------------- |
| Interface e servidor     | Next.js 16.3.1 com App Router                 |
| Linguagem                | TypeScript                                    |
| Interface visual         | React 19 e Tailwind CSS 4                     |
| Autenticação e banco     | Supabase Auth, PostgreSQL e Supabase Realtime |
| Inteligência artificial  | Ollama local por rotas server-side do Next.js |
| Qualidade de código      | ESLint e Prettier                             |
| Gerenciamento de pacotes | npm com `package-lock.json`                   |

O Next.js concentra páginas, componentes e rotas de servidor no diretório `src/app`. O Supabase é acessado no navegador por `src/lib/supabase-browser.ts` e no servidor por `src/lib/supabase-server.ts`. A aplicação usa as APIs públicas do Supabase com as políticas de segurança configuradas no banco.[1] [2]

## Requisitos

Antes de iniciar, instale:

- **Node.js 20.9 ou superior** e npm. O instalador do projeto valida a versão principal do Node.js.
- Uma conta e um projeto no [Supabase](https://supabase.com/).
- **Ollama** apenas se quiser utilizar compilação ou revisão por IA. A aplicação funciona sem Ollama para escrita, colaboração e edição manual.
- Git, caso o projeto seja clonado do GitHub.

As versões exatas das dependências JavaScript ficam registradas em `package-lock.json`. Por isso, os instaladores usam `npm ci` em vez de uma instalação livre com `npm install`.[3]

## Instalação rápida

Clone o repositório e entre na pasta do projeto:

```bash
git clone https://github.com/SEU_USUARIO/inertia.git
cd inertia
```

### Windows PowerShell

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\setup.ps1
```

### macOS ou Linux

```bash
bash scripts/setup.sh
```

Os scripts verificam o Node.js e o npm, executam `npm ci` usando o lockfile e criam `.env.local` a partir de `.env.example` quando esse arquivo ainda não existe. Eles não sobrescrevem um `.env.local` existente.

Se preferir fazer a instalação manualmente:

```bash
npm ci
cp .env.example .env.local
```

No Windows, o equivalente é:

```powershell
npm ci
Copy-Item .env.example .env.local
```

## Variáveis de ambiente

Abra `.env.local` e substitua os valores de exemplo pelos dados do seu projeto Supabase. A chave anônima pública pode ser usada no navegador quando as políticas RLS estão corretamente configuradas; nunca coloque uma chave secreta do Supabase no frontend.[2]

```env
NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua-chave-anon-publica

# Opcional. O padrão é http://localhost:11434.
OLLAMA_BASE_URL=http://localhost:11434
```

O arquivo `.env.local` está excluído pelo `.gitignore` e não deve ser enviado ao GitHub. Envie apenas `.env.example`, sem valores reais.

## Configuração do Supabase

Crie um projeto no Supabase e abra o **SQL Editor**. As migrations devem ser aplicadas em ordem, respeitando as dependências entre tabelas, funções, políticas RLS e tipos enumerados.

A pasta versiona estas migrations:

| Arquivo                         | Finalidade                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `0001_initial_schema.sql`       | Schema base reconstruído: perfis, livros, membros, capítulos, mensagens, convites, RPCs e RLS. |
| `0002_chapter_messages.sql`     | Estrutura legada de mensagens por capítulo.                                                    |
| `0005_secure_message_reads.sql` | Função segura para leitura de mensagens excluídas.                                             |
| `0006_editorial_layers.sql`     | Manuscritos, versões, sugestões e criação de versões.                                          |
| `0007_review_runs.sql`          | Controle de execução e bloqueio de revisões duplicadas por versão.                             |
| `0008_chapter_descriptions.sql` | Descrição opcional dos capítulos para contexto editorial e futuro uso pela IA.                 |

> **Nota:** `0001_initial_schema.sql` foi reconstruída a partir do schema ativo do projeto, dos contratos usados pela aplicação e das migrations já versionadas. Ela recompõe o banco para instalações novas, mas não é um dump dos dados atuais nem uma cópia byte a byte do histórico original. Valide-a em um projeto Supabase de teste antes de usar em produção.

As migrations `0003` e `0004` não são necessárias para uma instalação nova porque a migration base consolidada já contém os objetos necessários para que `0005`, `0006`, `0007` e `0008` sejam aplicadas em sequência. A migration `0007_review_runs.sql` é necessária para a revisão editorial com bloqueio de duplicidade. A `0008_chapter_descriptions.sql` é necessária para editar e exibir a descrição dos capítulos.

Para um ambiente novo, o procedimento recomendado é:

1. Criar o projeto Supabase.
2. Configurar o provedor de autenticação por e-mail em **Authentication > Providers**.
3. Aplicar `supabase/migrations/0001_initial_schema.sql`.
4. Aplicar as demais migrations do diretório `supabase/migrations` em ordem, incluindo `0008_chapter_descriptions.sql`.
5. Copiar a URL e a chave anônima da área **Project Settings > API** para `.env.local`.
6. Criar uma conta na aplicação e testar a criação de um livro e de um capítulo.

## Configuração do Ollama

A integração de IA é local e opcional. Instale o [Ollama](https://ollama.com/) e baixe um modelo compatível:

```bash
ollama pull qwen3:4b-instruct
```

Inicie o serviço do Ollama, caso ele ainda não esteja em execução:

```bash
ollama serve
```

O Inertia acessa o Ollama por rotas server-side. Por padrão, o endereço usado é `http://localhost:11434`; para outro endereço, defina `OLLAMA_BASE_URL` em `.env.local`. A rota de saúde verifica os modelos instalados e recomenda modelos com sufixo `instruct`.

O modelo `qwen3:4b-instruct` é o modelo recomendado para este fluxo. Modelos sem a variante `instruct` podem apresentar comportamento de raciocínio incompatível com a saída editorial esperada.

### Fluxo editorial

A IA recebe somente mensagens classificadas como **História**. Mensagens **Comentário** permanecem disponíveis na Fonte, mas não são enviadas para compilação ou revisão.

A compilação cria uma nova versão do Manuscrito e não modifica nenhuma mensagem original. Depois, a revisão analisa essa versão em blocos, salva Sugestões e permite que os autores decidam individualmente entre aceitar ou rejeitar cada proposta.

A descrição do livro pode ser usada para informar gênero, tom e escolhas estilísticas. Por exemplo:

```text
Ficção científica de aventura, com ação exagerada, humor e linguagem cinematográfica.
Não suavizar exageros narrativos quando forem escolhas intencionais dos autores.
```

## Executando o projeto

Inicie o servidor de desenvolvimento:

```bash
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000) no navegador.

Com o projeto aberto, o fluxo básico é:

1. Criar uma conta ou entrar com uma conta existente.
2. Criar um livro e preencher título e descrição.
3. Criar o primeiro capítulo.
4. Convidar o segundo autor pelo link de convite.
5. Escrever mensagens no chat do capítulo.
6. Classificar cada mensagem como História ou Comentário.
7. Abrir o painel editorial quando quiser gerar um Manuscrito.
8. Selecionar um modelo disponível no Ollama e compilar a Fonte.
9. Revisar uma versão compilada e decidir manualmente o destino das Sugestões.

Para parar o servidor, pressione `Ctrl+C` no terminal.

## Scripts disponíveis

| Comando                | Finalidade                                                |
| ---------------------- | --------------------------------------------------------- |
| `npm run dev`          | Inicia o servidor de desenvolvimento.                     |
| `npm run build`        | Gera a build de produção.                                 |
| `npm run start`        | Inicia a aplicação compilada.                             |
| `npm run lint`         | Executa o ESLint.                                         |
| `npm run format`       | Formata os arquivos TypeScript, TSX, CSS e configurações. |
| `npm run format:check` | Verifica a formatação sem modificar os arquivos.          |

Antes de abrir um Pull Request, execute:

```bash
npm run format:check
npm run lint
npm run build
```

## Estrutura principal

```text
src/
  app/
    api/ollama/                 Rotas server-side para saúde, compilação e revisão
    app/                        Área autenticada de livros e capítulos
    cadastro/                   Tela de cadastro
    convite/[token]/            Aceitação de convite de coautoria
    login/                      Tela de login
  lib/
    ollama-browser.ts           Tipos e helpers de comunicação com Ollama
    supabase-browser.ts         Cliente Supabase para o navegador
    supabase-server.ts          Cliente Supabase para o servidor
    wattpad-markdown.tsx        Renderização Markdown do Manuscrito e das mensagens
supabase/
  migrations/                   SQL versionado das camadas do banco
scripts/
  setup.ps1                     Instalação para Windows PowerShell
  setup.sh                      Instalação para macOS e Linux
.env.example                    Modelo seguro de variáveis de ambiente
.prettierrc.json                Convenção de formatação
package-lock.json               Versões exatas das dependências
```

## Segurança e dados

A Fonte é tratada como conteúdo autoral original. As operações de IA criam versões e sugestões separadas, e a aplicação não deve usar a IA para sobrescrever mensagens.

O Supabase deve permanecer protegido por autenticação e políticas RLS. Não versione `.env.local`, tokens, chaves secretas, dumps de usuários ou arquivos de log. A chave `NEXT_PUBLIC_SUPABASE_ANON_KEY` é pública por natureza, mas isso não substitui as políticas corretas do banco.

Backups JSON devem ser armazenados com cuidado, pois podem conter conteúdo autoral e informações de colaboração.

## Solução de problemas

| Sintoma                                     | Verificação recomendada                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| A aplicação não inicia                      | Confirme Node.js 20.9+, execute `npm ci` e verifique se `.env.local` existe.               |
| Login ou cadastro falha                     | Confira URL, chave anônima e provedor de e-mail no Supabase.                               |
| Livros ou capítulos não carregam            | Verifique se o schema inicial e as migrations foram aplicados no projeto correto.          |
| Ollama aparece offline                      | Execute `ollama serve`, confirme `http://localhost:11434` e revise `OLLAMA_BASE_URL`.      |
| O modelo não aparece                        | Execute `ollama list` e instale um modelo com `ollama pull`.                               |
| A revisão informa que o controle não existe | Aplique `supabase/migrations/0007_review_runs.sql`.                                        |
| Comentários não chegam à IA                 | Esse é o comportamento esperado: somente mensagens História são processadas.               |
| A compilação demora                         | Confirme se o Ollama está ativo, use um modelo `instruct` e observe o terminal do Next.js. |

## Publicando no GitHub

Antes do primeiro commit, confirme que `.env.local` não será incluído:

```bash
git status
```

Se o repositório ainda não existir localmente:

```bash
git init
git add .
git commit -m "chore: prepare Inertia for GitHub"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/inertia.git
git push -u origin main
```

Se o repositório já existir no GitHub, substitua `origin` pela URL correta. Não publique credenciais, arquivos `.env.local`, `node_modules`, `.next`, logs locais ou backups de usuários.

Antes de disponibilizar o projeto para outras pessoas, recomenda-se:

- validar `0001_initial_schema.sql` em um projeto Supabase de teste antes de usar em produção;
- confirmar que a migration `0007_review_runs.sql` foi aplicada no ambiente de produção;
- escolher e adicionar uma licença no arquivo `LICENSE`;
- revisar o nome do repositório e remover referências de ambiente pessoal;
- configurar variáveis de ambiente e serviços externos na plataforma de deploy;
- executar as verificações de formatação, lint e build em uma máquina limpa.

## Licença

Este projeto ainda não define uma licença no repositório. Adicione um arquivo `LICENSE` antes de permitir reutilização ou distribuição por terceiros.

## Referências

[1]: https://nextjs.org/docs "Next.js Documentation"
[2]: https://supabase.com/docs "Supabase Documentation"
[3]: https://docs.npmjs.com/cli/v10/commands/npm-ci "npm ci Documentation"
[4]: https://ollama.com/ "Ollama"

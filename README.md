# 🔗 HireLinks

**EN** · [PT](#pt)

HireLinks finds job links that match **your** skills and saves them in a spreadsheet that [FlashHire](https://github.com/rayssarrsilva/FlashHire) reads and applies to. You choose the sites, the keywords and the minimum match (40% to 100%). For up to 3 hours (you set the time) it reads Gupy, LinkedIn, Indeed, Glassdoor, Get on Board, Remotive, Remote OK, We Work Remotely and company career pages (Greenhouse, Lever, Ashby), scores every job against your skills and keeps only the ones that fit.

## Table of contents
- [Features](#features)
- [How the match is calculated](#how-the-match-is-calculated)
- [How it works](#how-it-works)
- [Tech stack](#tech-stack)
- [Run it](#run-it)
- [Using it with FlashHire](#using-it-with-flashhire)
- [Tests](#tests)
- [Responsible use](#responsible-use)

## Features
- **Your skills, from your résumé:** upload the PDF, HireLinks shows the skills it found and you confirm them. Nothing is made up.
- **Equivalents count the same:** if a job asks for Vitest and you have Jest, it counts as met. You edit the groups.
- **Time-boxed runs:** default 3 hours, with a goal (default 20 jobs). It keeps going after the goal until the time is up, or stops early when the sites have nothing new.
- **Filters that match how you job-hunt:** areas (front-end, QA…), skip internships and senior roles, mid-level only from a higher match, published in the last N days, on-site only in your cities (or above a salary you set), and remote jobs that only hire in another country ("US only") are left out.
- **Never repeats a link:** links already delivered in earlier sheets are skipped, and the same job found on two sites is kept once.
- **The sheet saves itself** after every new job (.xlsx and .csv), so stopping early never loses anything.
- **Transparent:** for each job you see the requirements you have, the equivalents and what is missing. A panel shows why the other jobs were left out.
- **Needs you only when a site does:** if Indeed or Glassdoor shows an "are you human?" check or a login wall, HireLinks asks you to handle it in the browser window and carries on.
- **Bilingual:** interface and spreadsheet in Portuguese or English.

## How the match is calculated
```
match = (requirements you have + requirements you have an equivalent of) ÷ requirements found in the job
```
Requirements are the skills found in the job text (React, TypeScript, Cypress, Figma, accessibility…), plus "advanced English" and "N+ years of experience" when the job asks for them. Jobs where fewer than 3 requirements were recognized are skipped (the percentage would not mean much; you can change this).

## How it works
```
sites (API, public pages, real browser) → new link? (history + duplicates) → right area? (title)
→ open the job only now → requirements → match % → filters → spreadsheet (link in column A)
```

| Site | How HireLinks reads it |
|---|---|
| Gupy | public portal API + job page |
| LinkedIn | public guest pages (logged-out view), slow pace, no login |
| Indeed, Glassdoor | a real browser (Edge or Chrome) with HireLinks' own profile, human pace |
| Get on Board, Remotive, Remote OK, We Work Remotely | public APIs / RSS |
| Greenhouse, Lever, Ashby | public job-board APIs of the companies you list |

Not included: **Wellfound** (blocks automated access) and **Workable** (no public listing per company without its private API).

## Tech stack
TypeScript (strict) · Node.js · Fastify · React 19 + Vite · Playwright · SQLite (`node:sqlite`) · ExcelJS · Zod · Vitest · GitHub Actions · Dependabot

## Run it
Requirements: Node.js 22.13+ and Microsoft Edge or Google Chrome.
```bash
git clone https://github.com/rayssarrsilva/HireLinks.git
cd HireLinks
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci
npm start
```
On Windows, double-click `INICIAR-HireLinks.bat`. The app opens at http://127.0.0.1:4174 (FlashHire uses 4173, so both can run together). Sheets are saved in the `exports` folder.

First run: **Your profile** → upload your résumé and confirm your skills → **Search & filters** → **Collect**.

## Using it with FlashHire
In FlashHire, open **Fila → Adicionar vagas → Planilha** and choose the `.xlsx` or `.csv` from HireLinks. Column A always holds the job link in the format FlashHire expects (LinkedIn `/jobs/view/ID`, Glassdoor with `jl=`, Indeed `viewjob?jk=`, Gupy job page). The link-reading code is shared with FlashHire, and a test reads HireLinks' sheets with FlashHire's own reader.

## Tests
```bash
npm test            # match, filters, every site's parser, links accepted by FlashHire, .xlsx/.csv read by FlashHire's reader
npm run test:e2e    # the real engine against local pages that imitate each site, incl. an "are you human?" check in a real browser
```

## Responsible use
HireLinks is a personal tool: it runs on your computer, reads only public job listings, at a slow pace and in small volume, and never logs in to LinkedIn. It does not bypass captchas or bot detection: it asks you. Check each site's terms; LinkedIn, Indeed and Glassdoor restrict automated access.

---

<a id="pt"></a>

# 🔗 HireLinks (PT)

O HireLinks encontra links de vagas que combinam com as **suas** habilidades e salva numa planilha que o [FlashHire](https://github.com/rayssarrsilva/FlashHire) lê para se candidatar. Você escolhe os sites, as palavras-chave e a compatibilidade mínima (de 40% a 100%). Por até 3 horas (você define o tempo), ele lê Gupy, LinkedIn, Indeed, Glassdoor, Get on Board, Remotive, Remote OK, We Work Remotely e páginas de carreira de empresas (Greenhouse, Lever, Ashby), calcula a compatibilidade de cada vaga e guarda só as que servem.

## Funcionalidades
- **Suas habilidades, do seu currículo:** envie o PDF, o HireLinks mostra o que encontrou e você confirma. Nada é inventado.
- **Equivalentes valem igual:** se a vaga pede Vitest e você tem Jest, conta como cumprido. Você edita os grupos.
- **Coleta com tempo:** 3 horas por padrão, com meta (20 vagas por padrão). Depois da meta ele continua até o tempo acabar, ou para antes se os sites não tiverem mais vagas novas.
- **Filtros do seu jeito de procurar:** áreas (front-end, QA…), pular estágio e sênior, pleno só com compatibilidade maior, publicadas nos últimos N dias, presencial só nas suas cidades (ou acima de um salário que você define) e vagas remotas só para outro país ("US only") ficam de fora.
- **Nunca repete link:** links já entregues em planilhas anteriores são pulados, e a mesma vaga achada em dois sites entra uma vez.
- **A planilha se salva sozinha** a cada vaga nova (.xlsx e .csv); parar antes não perde nada.
- **Transparente:** em cada vaga você vê os requisitos que tem, os equivalentes e o que falta. Um painel mostra por que as outras vagas ficaram de fora.
- **Só chama você quando o site exige:** se o Indeed ou o Glassdoor mostrarem a verificação "você é humano?" ou pedirem login, o HireLinks avisa, você resolve na janela do navegador e ele continua.
- **Bilíngue:** interface e planilha em português ou inglês.

## Como a compatibilidade é calculada
```
compatibilidade = (requisitos que você tem + requisitos que você tem um equivalente) ÷ requisitos encontrados na vaga
```
Requisitos são as habilidades citadas na vaga, mais "inglês avançado" e "N+ anos de experiência" quando a vaga pede. Vagas com menos de 3 requisitos reconhecidos ficam de fora (a porcentagem não diria muita coisa; dá para mudar).

## Como rodar
Precisa do Node.js 22.13+ e do Edge ou do Chrome. Use os comandos acima ou dê dois cliques em `INICIAR-HireLinks.bat` no Windows. Abre em http://127.0.0.1:4174 e as planilhas ficam na pasta `exports`.

## Usando com o FlashHire
No FlashHire: **Fila → Adicionar vagas → Planilha** e escolha o `.xlsx` ou `.csv` do HireLinks. A coluna A sempre tem o link no formato que o FlashHire espera.

## Uso responsável
Ferramenta pessoal: roda no seu computador, lê só vagas públicas, devagar e em pouco volume, e nunca entra na sua conta do LinkedIn. Não burla captcha nem detecção de robôs: pede para você. Confira os termos de cada site; LinkedIn, Indeed e Glassdoor restringem acesso automatizado.

## License · Licença
MIT © Rayssa Roberta Rodrigues Silva

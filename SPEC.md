Kontext a cíl
Nástroj pro Android developera ve firmě Futured. Každý den loguju práci do Tempa (Jira time tracking plugin). Potřebuju nástroj, který vezme mou aktivitu z GitHubu a Slacku, zobrazí ji přehledně po dnech a pomůže mi rychle sestavit Tempo log entryi (datum + Jira issue key + strávený čas + popis).
Nástroj běží lokálně jako Node.js server. Žádný cloud, žádná databáze. Konfigurace přes .env soubor.

Tech stack

Backend: Node.js + Express (bez TypeScript pro jednoduchost, nebo s — dle úvahy)
Frontend: React + Vite, nebo single-page vanilla JS — dle úvahy, hlavně funkčnost a rychlost
Styling: dle uvážení, ale čisté, dark theme, hustota informací důležitější než vizuální efekty
Spuštění: npm start spustí server na localhost:3333, otevře prohlížeč


Architektura
/
├── server/
│   ├── index.js          # Express server
│   ├── github.js         # GitHub API client
│   ├── slack.js          # Slack API client (proxy přes server → žádné CORS problémy)
│   └── tempo.js          # Tempo/Jira API client (volitelné)
├── client/               # React nebo vanilla frontend
├── .env.example
└── package.json
Server slouží frontend a zároveň je proxy pro Slack + GitHub API (žádné CORS problémy na frontendu).

Konfigurace .env
GITHUB_TOKEN=ghp_xxx
GITHUB_USERNAME=davidkocnar
SLACK_TOKEN=xoxp-xxx
JIRA_BASE_URL=https://futured.atlassian.net
JIRA_EMAIL=david.kocnar@futured.app
JIRA_API_TOKEN=xxx
TEMPO_TOKEN=xxx
PORT=3333

Features — co musí umět
1. Načítání dat
   GitHub — přes /users/{username}/events API:

PushEvent → commity (zpráva, repo, branch, čas)
PullRequestEvent → PR otevřen / merged / closed
PullRequestReviewEvent → review (approved / changes requested / commented)
IssueCommentEvent + PullRequestReviewCommentEvent → komentáře
CreateEvent → nová větev

Slack — přes search.messages API s from:me after:X before:Y:

Text zprávy (zkrácený na 150 znaků), kanál, čas, permalink

Oboje se fetchuje na backendu, frontend dostane čistá JSON data. Data se cachují do paměti serveru po dobu běhu (ne na disk) — aby se při listování mezi dny znovu neloadovalo.
2. Zobrazení
   Hlavní layout:

Levý sidebar: miniaturní kalendář měsíce. Dny s aktivitou mají vizuální indikátor (jiná barva nebo tečka). Klik = zobrazí den.
Pravá část: detail vybraného dne.

Detail dne:

Sekce GitHub: seřazeno chronologicky. Každý event má čas, typ (commit / PR / review...), název/zpráva, repo (kliknutelný odkaz).
Sekce Slack: seřazeno chronologicky. Kanál, čas, zkrácený text zprávy, link na zprávu.
Eventy ze stejného repo / kanálu jsou vizuálně seskupeny nebo označeny stejnou barvou.

3. Project mapping
   V UI je možné nastavit mapování — repo nebo Slack kanál → Jira project key. Příklady:

futuredapp/colop-go → COLOP
futuredapp/modry-zivot-kmp → MZ
Slack #colop → COLOP
Slack #kaktus → KAK

Mapování se ukládá do mappings.json v rootu projektu. V UI je jednoduchý editor (přidat / odebrat / upravit záznam).
U každého eventu v detailu dne se zobrazí přiřazený project key (nebo "?" pokud nenamapováno).
4. Sestavení Tempo logu
   V detailu dne je panel "Tempo log" vpravo nebo dole.
   Uživatel zde může:

Kliknout na event a přidat ho do logu (nebo drag & drop)
Přímo napsat nebo upravit Jira issue key (např. COLOP-42), nebo zadat jen project key a dopsat číslo
Zadat čas v minutách nebo formátu 1h 30m
Upravit popis (předvyplněný z aktivit)

Log entries jsou seznam. Každá položka: [issue key] [čas] [popis].
Tlačítko "Zkopírovat" — zkopíruje celý denní log do clipboardu jako plain text v čitelném formátu.
Tlačítko "Odeslat do Tempa" (pokud jsou vyplněny Tempo credentials v .env) — zavolá Tempo API a vytvoří worklogy pro daný den. Používá Tempo v4 API (POST /4/worklogs). Po úspěšném odeslání zobrazí potvrzení.
5. Navigace a UX

Klávesové zkratky: ← / → pro předchozí/další den, T pro dnešek
Při startu se zobrazí dnešní den (nebo poslední pracovní den pokud dnes není aktivita)
Přepínání měsíce šipkami v headeru
Loading state s progressem při fetchování dat
Chybové stavy s jasnou zprávou (neplatný token, rate limit, proxy error)

6. Rozšiřitelné nicméně nice-to-have (pokud zbyde čas)

Vyhledávání přes Jira API pro autocomplete issue keye při psaní
Barevné odlišení projektů konzistentně napříč celou UI
Týdenní souhrn (kolik hodin na který projekt)


Co Claude Code dostane k dispozici

.env.example s popisem všech proměnných
Tento dokument jako SPEC.md v rootu projektu
Žádný existující kód — staví od nuly


Acceptance criteria
Nástroj je hotový, když:

npm install && npm start spustí vše bez chyby
Po vyplnění .env s platnými tokeny se načtou data pro aktuální měsíc
Kliknutím na den vidím mé GitHub eventy a Slack zprávy
Mohu sestavit Tempo log a zkopírovat ho do clipboardu
Funguje na macOS v Chrome
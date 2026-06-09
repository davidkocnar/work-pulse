# WorkPulse — návod k instalaci

WorkPulse je nástroj pro přehled denní aktivity z GitHubu, Slacku, Kalendáře a Gmailu,
se kterým snadno zalogujete hodiny do Tempa.

Každý si ho spouští **lokálně na svém Macu** — žádná sdílená data, přihlašovací údaje zůstávají u vás.

---

## Varianta A — instalátor (doporučeno)

Instalátor se postará o vše automaticky: stáhne aplikaci, nainstaluje potřebné závislosti
a vytvoří WorkPulse.app v Aplikacích.

### Co budete potřebovat

- Mac s macOS 12 nebo novějším
- Přístup k internetu

### Postup

**1. Otevřete Terminal**

Stiskněte `Cmd + mezerník`, napište `Terminal` a potvrďte Enterem.

**2. Spusťte instalátor**

Zkopírujte tento příkaz, vložte ho do Terminálu a stiskněte Enter:

```
curl -fsSL https://raw.githubusercontent.com/davidkocnar/work-pulse/main/install.sh | bash
```

**3. Počkejte na dokončení**

Instalace trvá 1–5 minut podle rychlosti připojení. Průběh uvidíte přímo v Terminálu.

#### Časté situace během instalace

**Objeví se okno „Xcode Command Line Tools"**

Klikněte na **Instalovat** a počkejte, až se instalace dokončí (cca 5–10 minut).
Poté instalátor **spusťte znovu** stejným příkazem jako v kroku 2.

**Terminál se ptá na heslo**

Zadejte heslo od vašeho Macu (při psaní se nezobrazuje — je to normální) a stiskněte Enter.

**4. Spuštění aplikace**

Po úspěšné instalaci najdete **WorkPulse** v Aplikacích (Finder → Aplikace).

> **macOS varování „Aplikace od neznámého vývojáře":**
> Klikněte pravým tlačítkem na ikonu → zvolte **Otevřít** → potvrďte **Otevřít**.
> Toto se zobrazí jen při prvním spuštění.

---

## Varianta B — instalace souboru .dmg

Pokud nechcete používat Terminal, vyžádejte od správce soubor `WorkPulse.dmg`.

1. Otevřete stažený soubor `.dmg` dvojklikem
2. Přetáhněte ikonu WorkPulse do složky **Aplikace**
3. Odpojte disk (vysuňte `.dmg` v postranním panelu Finderu)
4. Spusťte WorkPulse z Aplikací

> **macOS varování „Aplikace od neznámého vývojáře":**
> Klikněte pravým tlačítkem na ikonu → zvolte **Otevřít** → potvrďte **Otevřít**.

---

## První spuštění — nastavení integrací

Po spuštění se automaticky otevře prohlížeč s průvodcem nastavením.
Propojte nástroje, které používáte:

| Integrace | Co uděláte |
|---|---|
| **GitHub** | Klikněte **Connect GitHub →** a přihlaste se svým GitHub účtem |
| **Slack** | Klikněte **Connect Slack →** a přihlaste se svým Slack účtem |
| **Jira / Tempo** | Vyplňte URL organizace, e-mail, Jira API token a Tempo token (viz níže) |
| **Google** (Kalendář + Gmail) | Klikněte **Connect Google →** a přihlaste se svým Google účtem |

Každou integraci lze přeskočit — aplikace funguje i s jen některými zdroji.

### Jak získat Jira a Tempo tokeny

**Jira API token**
1. Přejděte na [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Klikněte **Create API token**, pojmenujte ho (např. „WorkPulse") a zkopírujte hodnotu

**Tempo token**
1. V Tempu otevřete **Settings → API Integration → New Token**
2. Vyberte všechny scope, zkopírujte token

---

## Aktualizace

### Varianta A (instalátor)
Spusťte stejný příkaz jako při instalaci — skript rozpozná existující instalaci a stáhne jen změny.

### Varianta B (.dmg)
Vyžádejte od správce nový soubor `.dmg` a postup opakujte.

---

## Časté problémy

**Aplikace se nespustí / vidím prázdnou stránku**

Zkontrolujte, zda port 3333 není obsazený jinou aplikací. Restartujte WorkPulse.

**„Služby nejsou propojeny" i po nastavení**

Zkontrolujte zadané údaje v Settings (ikona ozubeného kola). Přihlašovací údaje se ukládají lokálně na vašem Macu.

**Tempo hlásí chybu při odesílání**

Ujistěte se, že issue key (např. `FTL-42`) existuje v Jiře a máte k němu přístup.

---

Dotazy směřujte na správce aplikace.

# Claude Code Usage

🌐 **Sprache**: [Hauptseite](README.md) · [English](README-en.md) · **Deutsch** · [繁體中文](README-zh-TW.md) · [简体中文](README-zh-CN.md) · [日本語](README-ja.md) · [한국어](README-ko.md) · [Português (Brasil)](README-pt-BR.md) · [Bahasa Indonesia](README-id.md)

**Lokale Nutzungsübersicht für Claude Code und Codex in der VS-Code-Statusleiste.**
Die Erweiterung liest lokale Nutzungsprotokolle und zeigt Anbieter-Daten mit
jeweils passender Bedeutung an. Sie ist **kein Abrechnungswerkzeug**.

## Auf einen Blick

- **Ruhigere Aktualisierung und klare Wiederherstellung:** Die Pause gilt für beide
  Seiten, nicht für Hintergrunderfassung und Statusleiste. Fehler behalten geprüfte
  Daten; Nachindizierung und Wiederholungswartezeit sind getrennt. Unveränderte,
  ausgeblendete Panels verwenden begrenzte Caches.
  Vollständig indizierte Codex-Historien bleiben bei neuen Protokolldaten ruhig;
  mehrdeutige Sitzungen bleiben ein Qualitätshinweis, kein wiederholter Nachlauf.
- **Genaue Vorschauen und sichere Einstellungen:** KI-Ziel, Format und Modell sind
  sichtbar, ohne stillen Anbieterwechsel. Share Cards exportieren das bestätigte SVG;
  geänderte Optionen verlangen eine neue Vorschau. Zurücksetzen behält den API-Schlüssel,
  und das Codex-Verzeichnis lässt sich auf beiden Einstellungsseiten korrigieren.
- **Begrenzte Preisdiagnosen:** Warnungen zu unbekannten Modellen werden pro
  Extension-Host-Lauf dedupliziert und insgesamt begrenzt ([#122](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/issues/122)).
  Abgelaufene Analysebeiträge
  bleiben leer, ohne laufende inkrementelle Aktualisierungen zu stören.
- **Neue Modelle und sichere Aktualisierung:** eigene Standard-/Cachepreise für
  Opus 5.5, Sonnet 5.5, GPT-6.1 Sol, GPT-6 Sol und GPT-6 Luna. Ungültige Modellfelder
  blockieren nicht den gesamten Index; Aggregate werden nur einmal pro Aktualisierung
  kopiert. Hintergrundresultate und Preisabrufe sind begrenzt. Unbekannte Codex-IDs
  bleiben ohne geschätzten Preis.
- **Große Historien:** unveränderte Inhaltszuordnung nutzt den Cache, KI-Steuerelemente
  bleiben aktuell. Anzeigeänderungen wiederholen keinen abgeschlossenen Kaltaufbau;
  verspätete Indexresultate können aktualisierte Preise nicht überschreiben.
  Die heutige Zuordnung wird pro Kalendertag zwischengespeichert: unveränderte
  Minutenabfragen innerhalb einer Stunde aktualisieren den Countdown ohne die gesamte
  Historie zu durchlaufen. Die stündliche Aktualisierung verborgener Bereiche berechnet
  die Inhaltszuordnung weiterhin einmal neu.
- **Sicheres Upgrade:** unveränderte Abfragen erhalten bestätigte Vorschauen; ein Wechsel
  des Claude-Verzeichnisses verwirft alte Daten auch bei pausierter Aktualisierung. Bestehende
  API-Schlüssel ohne explizites Format behalten Anthropic. Bei einem Konflikt Format und URL
  in den Einstellungen bewusst wählen und erneut prüfen. Neue Installationen verwenden
  OpenAI-kompatible Vorgaben, ohne alte Schlüssel still an einen anderen Host umzuleiten.
- **Claude Code:** geschätzte Token-Kosten und, bei gültiger Anmeldung, die
  offiziellen 5-Stunden- und Wochenquoten des aktiven Claude-Profils.
- **Codex:** heute verarbeitete Token und die zuletzt beobachtete
  verbleibende Wochenquote. Die Quote ist kein garantierter Live-Kontostand.
- **Dashboard:** Tages-, 30-Tage- und Gesamtansicht sowie Sitzungen, Projekte
  und aufbereitete lokale Empfehlungen. Diagramme lassen sich nach Monat,
  Tag und Stunde aufklappen, ohne beim Klick die Protokolle erneut zu lesen.
- **Teilen:** Ein gemeinsamer Arbeitsbereich mit Vorschau vor dem Export.
  Lokaler SVG-/Markdown-Export bleibt lokal; eine Veröffentlichung auf GitHub
  erfordert eine gesonderte Bestätigung. Die Funktion ist standardmäßig an
  und lässt sich in den Einstellungen ausschalten.

![Codex-Übersicht, synthetische Daten](images/v2.3.1/codex-overview-zh-CN-dark.png)

Das Bild nutzt synthetische Daten, nicht das Konto einer Person. Weitere
Abbildungen und Details stehen in der [ausführlichen englischen Hauptseite](README.md).

## Lokale Erfolge (Kandidat)

Der lokale Nachweisspeicher ist auf 64 KiB begrenzt. Alte Abzeichen haben kein
bekanntes Datum; neue gespeicherte Aktionen behalten ungelesene Erstaufnahmetage,
auch bei verpasstem Hinweis. Fenster führen Auszeichnungen zusammen; Löschen
hinterlässt eine leere Generationssperre gegen veraltete Schreibvorgänge.
Hinweise erscheinen nur im sichtbaren Vordergrundpanel, höchstens alle fünf Minuten
über Fenster und Neustarts hinweg. Nur bestätigte Anzeigen markieren ihre Gruppe
als gelesen; verpasste bleiben ungelesen. Maus- und Tastaturfokus pausieren das Ausblenden.
Verpasste Auszeichnungen stehen in einer zunächst eingeklappten Übersicht mit
höchstens sechs konkreten Stufen je Gruppe. Nur die ausdrückliche Bestätigung nach
erfolgreichem lokalem Speichern liest diese Gruppe; Ansehen, Anheften und Teilen
nicht. Spätere Auszeichnungen anderer Fenster bleiben ungelesen.
Zuletzt erhalten zeigt höchstens drei neue Serien; die einklappbaren Einträge umfassen
bis zu dreißig Stufen mit Regellinks. Daten bezeichnen die erste Erfassung, nicht die
ursprüngliche Erlangung; alte Daten bleiben unbekannt. Beim Ansehen werden Einträge
nicht als gelesen markiert und nicht zum Teilen ausgewählt.
In den Details erhaltener Abzeichen lassen sich bis zu drei Vertreter anheften.
Die Auswahl bleibt nach einem Neustart erhalten und ist keine Freigabe zum Teilen.
Ausgeblendete angeheftete Abzeichen können in einer einklappbaren Liste gelöst werden,
ohne den deaktivierten Anbieter wieder einzuschalten.

Importierte Plugin-Nutzungsnachweise bleiben ohne Hinweis. Erfolgreich gespeicherte
neue Aktionen können Abzeichen auch bei geschlossenem Dashboard freischalten, ohne versteckte Ansichten zu öffnen oder zu aktualisieren.

Der noch nicht veröffentlichte Kandidat 2.4.2 hat 46 Symbolserien mit 124 Stufenbedingungen: Modell-Token, Ausgabe/Cache,
Aktivität, Wochenrekorde und einige bewusst genutzte Plugin-Funktionen.
Jede Serie hat ein eigenes Motiv, ihre Stufen teilen es mit Stufenfarben. Zahlen sind ganzzahlig; Datengrenzen sind aufklappbar.
Fehlende oder veraltete Nachweise werden statt Nullfortschritt angezeigt und vom nächsten Ziel ausgeschlossen; erworbene Abzeichen bleiben gespeichert.
Geschlossene Karten zeigen den aktuellen Fortschritt zur nächsten Stufe; Zwischenziele auf langen Token-Leitern sind keine zusätzlichen Abzeichen, Hinweise oder Exportoptionen.
Meine Abzeichen und Nächste Ziele zeigen jeweils höchstens drei unterschiedliche Themen vor der Sammlung. Ziele brauchen aktuelle positive Nachweise; ungenutzte Modelle werden nicht empfohlen. Die Auswahl bleibt beim Browsen stabil; ein Klick öffnet die vorhandenen Regeln ohne Log-Lesen oder automatische Freigabe.
Nach vollständiger aktueller Indexierung zählen konfliktfreie Codex-Abstammungen für Token-/Agentenmeilensteine; Kalendererfolge brauchen weiterhin vollständige Identitäts- und Tagesnachweise.
Serien und Stufen werden getrennt gezählt. Lokale Filter bleiben nach Neuladen
erhalten; das nächste Ziel steht auf der Karte, alle Stufenregeln im aufklappbaren Bereich.
Standardmäßig an; **Local achievements** in ⚙ Settings (`enableAchievements`)
schaltet neue Auszeichnungen und den zusätzlichen Stunden-Nachlauf ab.
Beim Upgrade erscheint einmal ein nicht-modaler Hinweis mit Abschaltoption;
vorherige Abschaltungen bleiben erhalten. Historische Freischaltungen sind still.
Spätere Hinweise bleiben kurz im Dashboard, ohne Ton oder Fokuswechsel.
Bis zu neun gewählte Abzeichen lassen sich nach Vorschau als genau dieses SVG exportieren;
veraltete Antworten erlauben keinen Export. Direkte Wege führen zurück zur Galerie und zur Abschaltoption,
ohne GitHub-Anmeldung. Die Daten können mehrere Anmeldungen enthalten und
belegen keine persönliche Produktivität. [Speicherung und Löschen](LOCAL-DATA.md#local-achievements-242-candidate).

## Daten richtig lesen

Bei Codex gilt **verarbeitet = Eingabe + Ausgabe** und **nicht gecachte Nutzung
= nicht gecachte Eingabe + Ausgabe**. Gecachte Eingabe ist bereits Teil der
Eingabe; Reasoning ist bereits Teil der Ausgabe. Diese Werte dürfen nicht
nochmals addiert werden. Angezeigte API-Äquivalentkosten sind Schätzungen
anhand bekannter Modellpreise, **keine Rechnung oder Abo-Belastung**.
Claude- und Codex-Kosten oder Quoten werden nicht zusammengerechnet.
Fehlende oder noch nicht indizierte Protokolle können die Anzeige verkleinern;
die Codex-Quote bleibt die letzte lokale Beobachtung.

## Installation und Datenschutz

In VS Code unter **Erweiterungen** nach `Claude Code Usage` suchen oder
`ext install GrowthJack.claude-code-usage` ausführen. Das Dashboard öffnet
sich über die Statusleiste oder den Befehl **Show Usage Details**.
Sprache, Datenverzeichnis und Anzeigeoptionen können in den Einstellungen
angepasst werden. Claude-Protokolle werden lokal gelesen; der Codex-Index
speichert abgeleitete, pseudonyme Nutzungsdaten statt Gesprächsinhalten.
Die Indizes sind nach Protokollverzeichnis, Profil-Salt und Zeitzone getrennt.
Ein Neuaufbau betrifft nur den aktiven Index; „Alle löschen“ umfasst alle exakt
zugehörigen Indexdateien in diesem Erweiterungsspeicher.
Ein Zeitzonenwechsel kann einen vollständigen, nachweislich quellengleichen
Checkpoint schreibgeschützt wiederverwenden; nur Tages-/Stundenwerte werden
migriert, ohne die Haupthistorie neu aufzubauen.
KI-Beratung ist optional und sendet erst nach Vorschau und ausdrücklichem
Senden mit einem eigenen API-Schlüssel. Einzelheiten und Löschwege:
[Lokale Daten und Datenschutz](LOCAL-DATA.md).

Die vollständige Funktionsbeschreibung steht auf [Englisch](README.md)
und [vereinfachtem Chinesisch](README-zh-CN.md). Fehler und Vorschläge sind
unter [Issues](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/issues) willkommen.

## Credits und Lizenz

Die vollständige Liste der PR-Autoren und Issue-Meldenden steht unter
[Credits im Haupt-README](README.md#credits); zusammengeführte PRs und
nicht übernommene Vorschläge sind dort getrennt.

MIT-Lizenz. Die Pflege verwendet [Claude Code](https://claude.com/claude-code)
und [OpenAI Codex](https://developers.openai.com/codex/) als Werkzeuge;
menschliche Beiträge stehen im [Changelog](CHANGELOG.md).

[MIT-Lizenz](LICENSE)

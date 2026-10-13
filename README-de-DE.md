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

Abzeichendetails öffnen vorhandene aktuelle Modell-/Tokenstatistiken desselben Anbieters
mit Rückweg und erhaltenem Fokus. Keine Logsuche oder Ersetzung historischer Nachweise durch aktuelle Summen.

Beim Lösen alter angehefteter Abzeichen bleibt der Tastaturfokus im Thema, ohne Datenaktualisierung.
Die Erkundungsdetails zeigen gespeicherte Schritte: Sammlung, Vorschau und erfolgreicher lokaler Export.
Alte Abzeichen erfinden keine fehlenden Schritte; Feedback und Einstellungsänderungen bleiben unabhängig.
Das Symbol enthält keine festen Zahlen. Neue Hinweise bewegen nur das Abzeichen einmal für 440 ms;
Text, reduzierte Bewegung und hoher Kontrast bleiben statisch, ohne Ton oder Fokuswechsel.

Modelle je Aufgabe und die Anzahl von Mehrmodell-Aufgaben sind getrennte Erlebnisse.
Fable: gemeinsame Sitzung verlangt Ausgabe von Fable und einer weiteren erkannten
Claude-Familie in derselben Sitzung, nicht eine bestimmte Reihenfolge.

**Erfolgshinweise anzeigen** (`showAchievementNotices`) lässt sich separat ausschalten.
Abzeichen und ungelesene Einträge bleiben; erneutes Einschalten spielt keine alten Hinweise ab.

Nachweislich neue Claude-/Codex-Token-Stufen behalten ungelesene Erstaufnahmetage,
auch bei pausierten Dashboard-Updates. Unterstützt sind Modellfamilien, Ausgabe,
Cache-Lesezugriffe, Claude-Cache-Erstellung und Gesamtvolumen. Importe und manuelle
Neuindizierung bleiben still; kumulative API-Referenzwerte haben eigene Live-Nachweise, andere Nutzungsbereiche benötigen sie noch.

Der lokale Nachweisspeicher ist auf 64 KiB begrenzt. Alte Abzeichen haben kein
bekanntes Datum; neue gespeicherte Aktionen behalten ungelesene Erstaufnahmetage,
auch bei verpasstem Hinweis. Fenster führen Auszeichnungen zusammen.
`achievements-v2.json` ist der maßgebliche Speicher; v1 dient nur als schreibgeschützte Migrationseingabe.
Bereits gespeicherte Auszeichnungen der 21 geänderten Modell-/Team-/Effort-/Regenbogen-Bedingungen bleiben begrenzt archiviert,
mit unbekannten Daten; altes Gold belegt keine neuen Regeln. Gemeinsame v1-Lease,
v2-Löschmarkierung und leere v1-Downgradesperre verhindern die Wiederherstellung gelöschter Auszeichnungen; Anbieterlogs bleiben unverändert.
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
Bis zu sechs Themen lassen sich über Pins auf geschlossenen Karten und eine durchsuchbare Auswahl anheften und ordnen.
Manuell erscheinen nur gewählte Pins, automatisch höchstens drei Empfehlungen.
Auswahl und Reihenfolge bleiben nach Neustart erhalten und sind keine Freigabe zum Teilen.
Ausgeblendete angeheftete Abzeichen können in einer einklappbaren Liste gelöst werden,
ohne den deaktivierten Anbieter wieder einzuschalten.

Importierte Plugin-Nutzungsnachweise bleiben ohne Hinweis. Erfolgreich gespeicherte
neue Aktionen können Abzeichen auch bei geschlossenem Dashboard freischalten, ohne versteckte Ansichten zu öffnen oder zu aktualisieren.

Der noch nicht veröffentlichte Kandidat 2.4.2 hat laut Quellkatalog 50 Themenkarten, 174 Freischaltbedingungen und 52 Motivgruppen: Modell-Token, Ausgabe/Cache,
Aktivität, Wochenrekorde und einige bewusst genutzte Plugin-Funktionen.

15 Claude-/Aktivitätsserien erhalten Platin und Legendär; die ersten drei Schwellen und Nachweise bleiben unverändert, die Motive werden weiterverwendet. Aktivitätstage, Ausgabe und Sitzungen ermöglichen Fortschritt bei drei konzentrierten Tagen pro Woche, ohne Codex oder höhere Ausgaben. Serien aufeinanderfolgender Tage werden nicht erweitert.

Davon betreffen 20 Bedingungen sechs getrennte Claude-/Codex-API-Äquivalent-Themen: bepreiste Gesamtsummen,
abgeschlossene Wochen ab Montag in der aktuellen Datenzeitzone und eine Claude-Sitzung bzw. ein verifizierter Codex-Aufgabenbaum.
Feste USD-Referenzpreise mit Versionsangabe verlangen bekannte exakte Modelle und vollständige Komponentenpreise einschließlich Claude-Cache-TTL.
Unbekannte Modelle bleiben unbepreist; belegte Teilmengen zeigen eine Untergrenze. Die Beträge sind keine Rechnung, Qualitätswertung oder Einkommensangabe.
Geldhistorie bleibt still. Nur kumulative Geldmeilensteine speichern bei verifizierten neuen Anhängen unter derselben Preisreferenz ungelesene Erstaufnahmetage; Wochen- und Einzelaufgabenwerte bleiben still mit unbekanntem Datum. Token-/Geldnachweise sind unabhängig und teilen einen Hinweisbatch; fehlgeschlagenes Speichern erzeugt kein Datum. Modell-/Team-/Effort-/Regenbogenregeln verbinden Ausgabe, wiederholte Nutzung und Umfang.
Die bestehende Codex-Effort-Karte zeigt aufgeklappt sechs Stufen mit Token-, Ausgabe-, Wurzelaufgabenfortschritt und informativem festen USD-Subtotal samt Abdeckung. Nur eigene positive Ausgabe je Wurzel × Effort zählt, ohne Approval-Reviewer; uneindeutige Modellzuordnung wird nicht proportional verteilt. Fehlende Nachweise bleiben unbekannt; keine neuen Regeln oder Einstellungen, keine Claude-Effort-Zuordnung.
Die Heatmap bietet Claude / Codex / Beide und standardmäßig Tokens; API-Äquivalent-Beträge müssen ausdrücklich gewählt werden.
Sie nutzt aktuelle Tagesschätzungen, keine Erfolgspreise: Claude geschätzt, Codex nur mit exakten bekannten Modellpreisen; fehlende Preise bleiben sichtbar, Teilbeträge sind Untergrenzen. Beträge beider Anbieter werden nie addiert.
Claude-Abdeckung prüft ausgewählte Modelle/Komponenten nur im Speicher; generische unbekannte Sonnet-Ersatzpreise zählen nicht. Fehlende Raten bleiben unbekannt, explizite Null ist gültig; gespeicherte Kosten bleiben gleich. Token-/versteckter Modus fragt weder Raten noch Geld ab.
Beträge ausblenden stellt Token-Farben, Texte und Markdown wieder her und verwirft die alte Vorschau. Export speichert die bestätigten SVG-Bytes mit Prüfungen vor und nach dem Speicherdialog, ohne neue Logsuche oder Netzaufrufe.
**Wöchentliches Kontingenttempo** (`showWeeklyQuotaPace`) ist standardmäßig aus und nutzt vorhandene Beobachtungen: 29% Nutzung bei 25% Zeit ergibt 116% für den Zyklus.
Keine Prognose in den ersten sechs Stunden, nach dreißig Minuten ohne neue Beobachtung oder nach Reset; ungültige Zugangsdaten ziehen sie auch bei pausiertem Dashboard zurück. Konto-/Quellenwechsel und Zählerrückgänge sperren sie bis zu einem verifizierten normalen Sieben-Tage-Wechsel.
Codex-Logs verifizieren derzeit kein Konto, daher ist die Prognose nicht verfügbar. Dashboard und Statusleisten-Tooltip teilen die Übersetzungen; Balkentext und eigene Formate bleiben gleich. Keine neuen Anfragen, Timer oder Historien.
Die Übersicht verwendet horizontale Karten mit begrenzter Breite: Bild, Name, Rang und Fortschritt bleiben zusammen. Pins sitzen in der Karte, nächste Ziele haben einen schmalen Fortschrittsbalken. Wenige Abzeichen verteilen sich nicht mehr über die ganze Bildschirmbreite; schmale Ansichten umbrechen ohne kleinere Schrift. Gold-Rangbezeichnungen bleiben in hellen Designs gut lesbar und behalten einen goldenen Akzent.

Größenwahl vor der Übersicht: Sammlung 56 / 80 / 112 px, Schaukasten 72 / 96 / 128 px; Pinfehler stehen beim Steuerelement, der Tastaturfokus bleibt stabil.
Der USD-Effort-Teilbetrag zählt nicht zur Qualifikation. Leere und unbepreiste Werte werden gekennzeichnet, Teilbeträge als Untergrenze; ungültige oder überlaufende Beträge bleiben unverfügbar.
Diese Anbindung ist im Kandidatencode vorhanden, belegt aber allein keine vollständige Node/UI-, native/F5-, installierte-VSIX- oder Leistungsabnahme. Ergebnisse stehen separat in lokalen Kandidatennachweisen; Browserprüfungen belegen keine native/F5-, Paketinstallations- oder Windows-Abnahme. Der Kandidat ist unveröffentlicht; die subjektive Darstellung braucht Nutzerprüfung. Details: [Englisch](README-en.md#heatmap-sharing-and-weekly-quota-pace-candidate).
Jede Serie hat ein eigenes Motiv, ihre Stufen teilen es mit Stufenfarben. Zahlen sind ganzzahlig; Datengrenzen sind aufklappbar.
Fehlende oder veraltete Nachweise werden statt Nullfortschritt angezeigt und vom nächsten Ziel ausgeschlossen; erworbene Abzeichen bleiben gespeichert.
Geschlossene Karten zeigen den aktuellen Fortschritt zur nächsten Stufe; Zwischenziele auf langen Token-Leitern sind keine zusätzlichen Abzeichen, Hinweise oder Exportoptionen.
Klein / Mittel / Groß verändern Abzeichen und Kartenrahmen, nicht Schriftgröße oder Klickflächen.
Nächste Ziele zeigt höchstens drei Themen mit aktuellen positiven Nachweisen; unbelegte Ziele und ungenutzte Modelle werden übersprungen. Die Auswahl bleibt beim Browsen stabil; ein Klick öffnet Regeln ohne Log-Lesen oder automatische Freigabe.
Nach vollständiger aktueller Indexierung zählen konfliktfreie Codex-Abstammungen für Token-/Agentenmeilensteine; Konfliktzweige und ihre Nachkommen sind ausgeschlossen.

Bei verifizierter, vollständig indexierter aktueller lokaler Historie können belegte Teilzeiträume
Aktivitäts-, Modellfamilien- und Wochen-Token-Fortschritt mit `≥` zeigen. Untergrenzen für Wochenbeträge
nutzen nur verifizierte ausgewählte Dateien mit vollständig datierter Nutzung; Preisabdeckung und
Datumsabdeckung sind unabhängig. Teilzeiträume belegen weder vollständige Historie noch Nullverbrauch;
Vierwochenmittel und gespeicherte Spitzenwerte bleiben bis zur vollständigen Abdeckung ausstehend.
Gesamt-/Aufgabenumfänge bleiben unverändert, ohne zusätzliche Quelldatenlesevorgänge, Speicherung oder Netzaufrufe.

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

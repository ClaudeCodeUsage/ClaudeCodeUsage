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

Version 2.5.0 verbindet lokale Erfolge mit Codex-Unterstützung für `.jsonl.zst` in `sessions` und `archived_sessions`. Zstd komprimiert verlustfrei, ohne LLM-Zusammenfassung: kleinere Dateien ändern die protokollierten Tokenzahlen nicht. Das Lesen bleibt lokal, ohne Quelldateien zu ändern oder entpackte Klartextkopien zu speichern; gleichnamige `.jsonl` im selben Ordner haben Vorrang. Natives Zstd (Node 22.15+ / 23.8+) benötigt keine neue Abhängigkeit; nicht unterstützte Hosts melden die Einschränkung und behalten zuletzt verifizierte Summen.

## Lokale Erfolge (2.5.0)

Sitzungsdaten verwenden dieselbe vollständige Zulassung wie der kanonische Index; geänderte Logs erfordern eine erneute Prüfung. Bestätigte neue Nutzung behält ihren ersten Nachweis auch bei Abbruch. Teilweise gespeicherte Ergebnisse werden gesondert gemeldet.

Alle ausklappen / einklappen speichert nur den Aufklappzustand der Karten im
bestehenden lokalen UI-Zustand; Quellen und Auszeichnungen bleiben unberührt.
Die Ränge heißen Bronze / Silber / Gold; IDs, Pins und Referenzpreislisten bleiben
gleich. Exakt gleiche Bedingungen und Einheiten erscheinen einmal. Ein gemeinsamer
Geldreferenzbereich nennt je aktiviertem Anbieter die aktuelle Preisliste samt Datum
und den Hinweis, dass dies keine Rechnung ist. Abweichende historische Preislisten
bleiben den genauen Auszeichnungen zugeordnet; Karten behalten Umfang und Preisabdeckung
ohne wiederholte Preis-/Berechnungsgrundlagen. Vollständig erreichte
Karten zeigen den ungekürzten aktuellen Wert; veraltete oder fehlende Belege werden
nicht durch einen Zielwert ersetzt.

Ausgeklappte Rangzeilen färben den Rangnamen mit rangspezifischen Theme-Farben
(Vordergrundfarbe bei hohem Kontrast); der Schwellenwert steht fett und rechtsbündig
in derselben Kopfzeile. Nur der nächste Rang über dem höchsten erreichten zeigt bei
bereitem Nachweis „In Arbeit“; spätere Ränge, vollständig erreichte Karten und ausstehende
Nachweise zeigen dieses Label nicht. Verifizierte Daten aus erhaltenen Logs erscheinen
als reine ISO-Daten; ihre Bedeutung wird einmal unter „Datengrundlage“ erklärt, die Herkunft
bleibt in title/ARIA. Liegen beide Daten vor, ist nur das verifizierte sichtbar; die erste
Erfassung bleibt in title/ARIA. Alleinstehende Ersterfassungsdaten behalten ihr ausdrückliches
Label, unbekannte Daten bleiben unbekannt. Auszeichnungen, Regeln, Datumsberechnungen und
gespeicherte Datensätze ändern sich dadurch nicht.

**Unabhängige Hauptaufgaben** zählt verifizierbare Codex-Wurzelzuordnungen mit
erkannter positiver Modellnutzung (Eingabe oder Ausgabe). Haupt- und Unteraufgaben
zählen zusammen einmal, nicht als abgeschlossene Aufgaben. Regel-IDs und Schwellen bleiben gleich.

Navigation und Seitentitel heißen **Teilen & vergleichen**. Abzeichenauswahlfelder
haben gleiche Breite und eine eigene Rangzeile. Die Symbolkorrektur
nutzt dieselbe lokale Ressourcenquelle wie die Haupt-Webview-CSP. Exportierte SVGs
enthalten den festen öffentlichen [Repository-Link](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage)
und umbrechende lange Beschriftungen. Vorschau/Export ergänzen weder automatische
Netzwerkanfragen noch persönliche Metadaten; ausdrückliche Auswahl und unveränderliche
bestätigte SVGs bleiben erhalten. Die umfassende visuelle Vereinheitlichung/Verschönerung
der Freigabeseite und ein dauerhaftes Nutzungsarchiv sind auf die nächste Version
verschoben und in Version 2.5.0 nicht implementiert.

Datumsangaben je Stufe entstehen nur im Arbeitsspeicher und bezeichnen das früheste
aus erhaltenen Logs belegbare Datum, nicht den vollständigen Kontoverlauf. Gespeicherte
Ersterfassungsdaten und Ungelesen-Markierungen bleiben erhalten. Tagesaggregate liefern
unterstützte Nutzungs-, Ausgabe-, Cache-, Modell-/Familien-, Aktivitäts- und Wochendaten.
Nur die manuelle Neuprüfung wertet bereits gehaltene Claude-Datensätze zusätzlich für
Ausgabesitzungen, Fable-Sitzungen und Fable/andere Familien in derselben Sitzung aus;
normale warme Aktualisierungen gruppieren diese Datensätze nicht erneut.
Nicht unterstützte Bedingungen behalten unbekannte Daten oder die erste Erfassung.

Die Neuprüfung läuft lokal und inkrementell, jeweils nur einmal gleichzeitig, ohne
erzwungenen Vollscan, Abzeichenlöschung oder OAuth-, Preis-, BYOK- und andere
Netzwerkanfragen. Sie erzwingt keine Auszeichnung. Beschäftigte Vorgänge, ein nicht
akzeptierter aktueller Indexgesamtbestand oder Fehler gelten nicht als Erfolg.
Verifizierte Teilhistorien behalten Untergrenzen oder unbekannte Werte; der Abschluss
bedeutet keine vollständige Abdeckung aller Auszeichnungsbereiche. Ein Abbruch vor dem Commit
fügt keine historischen Auszeichnungen hinzu; nach dem Commit bleiben gespeicherte Nachweise und
das erfolgreiche Ergebnis bestehen. Historische Abgleiche bleiben still.
[Datums- und Speichergrenzen](LOCAL-DATA.md#local-achievements-250).

Die Modellerkennung für Zusammenarbeit/Regenbogen ist von der Preisberechnung getrennt, sodass erkannte Modelle ohne Preis unbepreist bleiben; gespeicherte Geldwert-Auszeichnungen behalten veröffentlichte Preisbuchkennungen, und reine Claude-Spitzen bleiben bei unabhängigen Codex-Versionsänderungen erhalten.
Ladende, nicht verfügbare, geänderte und deaktivierte Aufzeichnungen erhalten klare Statusanzeigen statt leerer Zähler; verifizierte kumulative Claude-Nutzung zeigt `≥`, solange die Nachweise des aktivierten Codex noch nicht verifiziert sind.
Nächste Ziele zeigen Zielname und Zielrang, erhaltene Karten behalten ihren erreichten Rang, und SVG-Exporte zeigen jeden Rang nur einmal.

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
Gespeicherte Auszeichnungen bleiben nach Neustarts erhalten und werden zwischen Fenstern geteilt.
Alte Regeln behalten ihre Historie, belegen aber keine neuen Bedingungen. Löschen verändert keine Anbieterlogs.
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

Beim ausdrücklichen Teilen können erhaltene Abzeichen deaktivierter Anbieter gewählt werden.
Galerie und neue Pins richten sich nach aktivierten Anbietern; gespeicherte Abzeichen belegen
weder aktuellen Fortschritt noch die Berechtigung für neue Auszeichnungen.

Importierte Plugin-Nutzungsnachweise bleiben ohne Hinweis. Erfolgreich gespeicherte
neue Aktionen können Abzeichen auch bei geschlossenem Dashboard freischalten, ohne versteckte Ansichten zu öffnen oder zu aktualisieren.

Flach abgelegte Agentenlogs ohne durch den Pfad belegte Elternsitzung zählen nicht
als Nachweis für sitzungsbezogene Erfolge. Token, Preise, Tagessummen und sichtbare
Sitzungen bleiben unverändert; verschachtelte Zuordnung und gespeicherte Abzeichen bleiben erhalten.

Die Galerie in 2.5.0 bietet 50 Themenkarten, 178 Freischaltbedingungen und 52 Motivgruppen: Modell-Token, Ausgabe/Cache,
Aktivität, Wochenrekorde und einige bewusst genutzte Plugin-Funktionen.

15 Claude-/Aktivitätsserien erhalten Platin und Legendär; die ersten drei Schwellen und Nachweise bleiben unverändert, die Motive werden weiterverwendet. Aktivitätstage, Ausgabe und Sitzungen ermöglichen Fortschritt bei drei konzentrierten Tagen pro Woche, ohne Codex oder höhere Ausgaben. Serien aufeinanderfolgender Tage werden nicht erweitert.

Davon betreffen 24 Bedingungen sechs getrennte Claude-/Codex-API-Äquivalent-Themen: bepreiste Gesamtsummen,
abgeschlossene Wochen ab Montag in der aktuellen Datenzeitzone und eine Claude-Sitzung bzw. ein verifizierter Codex-Aufgabenbaum.
Beide Wochenserien haben fünf Ränge: Bronze 100 USD, Silber 500 USD, Gold 2.500 USD,
Platin 10.000 USD und Legendär 25.000 USD. Nur die letzten beiden je Anbieter sind neu;
alte IDs/Schwellen, abgeschlossene Wochen und die festen Referenzpreisgrundlagen bleiben unverändert.
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
Bei unklarer Kontozuordnung bleiben der API-äquivalente Gesamtwert und der ungenutzte
Wert des aktuellen Zyklus lokale Verlaufsschätzungen mit geringer Sicherheit, keine
Kontoguthaben. Eine genaue Trennung nach Konto ist zukünftiger Mehrkontenunterstützung
vorbehalten. Diese Näherung ist von der Prognose des wöchentlichen Kontingenttempos getrennt.

Die Übersicht verwendet horizontale Karten mit begrenzter Breite: Bild, Name, Rang und Fortschritt bleiben zusammen. Pins sitzen in der Karte, nächste Ziele haben einen schmalen Fortschrittsbalken. Wenige Abzeichen verteilen sich nicht mehr über die ganze Bildschirmbreite; schmale Ansichten umbrechen ohne kleinere Schrift. Gold-Rangbezeichnungen bleiben in hellen Designs gut lesbar und behalten einen goldenen Akzent.

Leichte Inline-SVG-Symbole ergänzen die vorhandenen übersetzten Beschriftungen für Teilen, Einstellungen, Filter, Größe, Schaukasten-Editor und Informationen; Zähler erscheinen als kompakte Chips.
Über 960 px passt sich die Abzeichenspalte dem Inhalt an, begrenzt auf zwei Übersichtskartenbreiten plus deren inneren Abstand. Die Zielspalte füllt den verbleibenden Platz; der Spaltenabstand beträgt 16 px. Bei höchstens 960 px stehen beide direkt untereinander mit 12 px Abstand. Ergänzende Verlaufsbereiche folgen beiden.
Größenwahl vor der Übersicht: Sammlung 56 / 80 / 112 px, Schaukasten 56 / 72 / 96 px; Pinfehler stehen beim Steuerelement, der Tastaturfokus bleibt stabil.
Der USD-Effort-Teilbetrag zählt nicht zur Qualifikation. Leere und unbepreiste Werte werden gekennzeichnet, Teilbeträge als Untergrenze; ungültige oder überlaufende Beträge bleiben unverfügbar.
Details: [Englisch](README-en.md#heatmap-sharing-and-weekly-quota-pace-250).
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
belegen keine persönliche Produktivität. [Speicherung und Löschen](LOCAL-DATA.md#local-achievements-250).

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

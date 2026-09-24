# Claude Code Usage

🌐 **Sprache**: [Hauptseite](README.md) · [English](README-en.md) · **Deutsch** · [繁體中文](README-zh-TW.md) · [简体中文](README-zh-CN.md) · [日本語](README-ja.md) · [한국어](README-ko.md) · [Português (Brasil)](README-pt-BR.md) · [Bahasa Indonesia](README-id.md)

**Lokale Nutzungsübersicht für Claude Code und Codex in der VS-Code-Statusleiste.**
Die Erweiterung liest lokale Nutzungsprotokolle und zeigt Anbieter-Daten mit
jeweils passender Bedeutung an. Sie ist **kein Abrechnungswerkzeug**.

## Auf einen Blick

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

import type {SupportedLanguage} from './types';
interface RollingCopy {scope:string;window:string;legacy:string;legacyShort:string;pending:string}
const copy:Record<SupportedLanguage,RollingCopy>={
 en:{scope:'Highest verified total in any seven consecutive, fully ended civil days in the selected time zone.',window:'Closed seven-day window',legacy:'Retained award under the previous calendar-week rule; the original recording date is unchanged.',legacyShort:'Previous calendar-week rule',pending:'No verified closed seven-day window yet.'},
 'zh-CN':{scope:'所选时区内，任意连续七个已结束自然日的最高可核验总量。',window:'已闭合七天窗口',legacy:'按旧自然周规则获得的徽章保留，原首次记录日期不变。',legacyShort:'旧自然周规则',pending:'尚无可核验的已闭合七天窗口。'},
 'zh-TW':{scope:'所選時區內，任意連續七個已結束自然日的最高可核驗總量。',window:'已結束七天視窗',legacy:'依舊自然週規則獲得的徽章保留，原首次記錄日期不變。',legacyShort:'舊自然週規則',pending:'尚無可核驗的已結束七天視窗。'},
 'de-DE':{scope:'Höchste belegte Summe in sieben aufeinanderfolgenden, vollständig abgeschlossenen Kalendertagen der gewählten Zeitzone.',window:'Abgeschlossenes Sieben-Tage-Fenster',legacy:'Die Auszeichnung nach der bisherigen Kalenderwochenregel bleibt erhalten; ihr erstes Erfassungsdatum bleibt unverändert.',legacyShort:'Frühere Kalenderwochenregel',pending:'Noch kein belegtes abgeschlossenes Sieben-Tage-Fenster.'},
 ja:{scope:'選択したタイムゾーンで、連続する終了済み7暦日の確認可能な最大合計。',window:'終了済み7日間',legacy:'旧暦週ルールの実績を保持します。最初の記録日は変更しません。',legacyShort:'旧暦週ルール',pending:'確認できる終了済み7日間はまだありません。'},
 ko:{scope:'선택한 시간대에서 완전히 종료된 연속 7일의 확인 가능한 최대 합계.',window:'종료된 7일 구간',legacy:'이전 달력 주 규칙으로 받은 배지는 유지되며 최초 기록일은 변경되지 않습니다.',legacyShort:'이전 달력 주 규칙',pending:'확인된 종료 7일 구간이 아직 없습니다.'},
 'pt-BR':{scope:'Maior total verificado em quaisquer sete dias civis consecutivos e encerrados no fuso selecionado.',window:'Janela encerrada de sete dias',legacy:'A conquista da regra anterior de semana civil é preservada; a data do primeiro registro não muda.',legacyShort:'Regra anterior de semana civil',pending:'Ainda não há janela encerrada de sete dias verificável.'},
 id:{scope:'Total terverifikasi tertinggi dalam tujuh hari kalender berturut-turut yang telah berakhir di zona waktu terpilih.',window:'Jendela tujuh hari selesai',legacy:'Lencana aturan minggu kalender sebelumnya dipertahankan; tanggal pencatatan pertama tidak berubah.',legacyShort:'Aturan minggu kalender lama',pending:'Belum ada jendela tujuh hari selesai yang terverifikasi.'},
};
export function achievementRollingCopyFor(locale:string):RollingCopy {
 return copy[Object.prototype.hasOwnProperty.call(copy,locale)?locale as SupportedLanguage:'en'];
}

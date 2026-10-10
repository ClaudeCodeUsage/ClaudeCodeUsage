import type {SupportedLanguage} from './types';
interface Copy {unit:string;reference:string;coverage:string;unpriced:string;total:string;week:string;session:string;task:string;note:string}
const copies:Record<SupportedLanguage,Copy>={
  en:{unit:'USD API equivalent',reference:'Achievement reference price',coverage:'Priced {percent}%; unpriced usage remains in Token totals.',unpriced:'Usage is unpriced.',
    total:'Cumulative verified API-equivalent resources.',week:'Peak of a completed Monday-start calendar week in the selected timezone.',session:'One confirmed complete session.',task:'One verified task tree, including recorded approval-reviewer resources.',note:'Baseline reference estimate, not a bill or a task-quality score.'},
  'zh-CN':{unit:'USD API 等价金额',reference:'成就参考价',coverage:'已定价 {percent}%；未定价用量仍计入 Token。',unpriced:'用量尚未定价。',
    total:'累计可核验的 API 等价资源投入。',week:'当前时区内，周一起算的已结束自然周峰值。',session:'一次可确认的完整会话。',task:'一次可确认的任务树，含已记录的审批审查器资源。',note:'按基准参考价估算，不是账单或任务质量评分。'},
  'zh-TW':{unit:'USD API 等效金額',reference:'成就參考價',coverage:'已定價 {percent}%；未定價用量仍計入 Token。',unpriced:'用量尚未定價。',
    total:'累計可核驗的 API 等效資源投入。',week:'目前時區內，週一起算的已結束自然週峰值。',session:'一次可確認的完整工作階段。',task:'一次可確認的任務樹，含已記錄的審批審查器資源。',note:'依基準參考價估算，不是帳單或任務品質評分。'},
  'de-DE':{unit:'USD API-Gegenwert',reference:'Referenzpreis des Nachweises',coverage:'{percent}% bepreist; unbepreiste Nutzung bleibt in Token-Summen.',unpriced:'Nutzung ohne Preis.',
    total:'Kumulierte bestätigte API-Ressourcen.',week:'Maximum einer abgeschlossenen Kalenderwoche ab Montag in der gewählten Zeitzone.',session:'Eine bestätigte vollständige Sitzung.',task:'Ein bestätigter Aufgabenbaum einschließlich erfasster Freigabeprüfer-Ressourcen.',note:'Basispreis-Schätzung, keine Rechnung oder Qualitätsbewertung.'},
  ja:{unit:'USD API 等価額',reference:'実績の参照価格',coverage:'価格確認済み {percent}%；未定価の使用量もトークン合計に含みます。',unpriced:'使用量の価格は未確認です。',
    total:'確認済み API 資源の累積等価額。',week:'選択したタイムゾーンの月曜開始・終了済み週の最大値。',session:'確認済みの完全な一セッション。',task:'記録済み承認レビュアーの資源を含む、確認済みの一タスクツリー。',note:'基準参照価格の推定値であり、請求額や品質評価ではありません。'},
  ko:{unit:'USD API 등가액',reference:'성과 참조 가격',coverage:'가격 확인 {percent}%; 미확인 사용량도 토큰 합계에 포함됩니다.',unpriced:'사용량 가격 미확인.',
    total:'확인된 API 자원의 누적 등가액.',week:'선택한 시간대의 월요일 시작 종료된 주간 최댓값.',session:'확인된 완전한 한 세션.',task:'기록된 승인 검토자 자원을 포함한 확인된 한 작업 트리.',note:'기준 가격 추정치이며 청구액이나 작업 품질 점수가 아닙니다.'},
  'pt-BR':{unit:'USD equivalente API',reference:'Preço de referência da conquista',coverage:'{percent}% com preço; uso sem preço continua nos totais de tokens.',unpriced:'Uso sem preço.',
    total:'Recursos API verificados acumulados.',week:'Pico de uma semana encerrada, iniciada na segunda-feira, no fuso selecionado.',session:'Uma sessão completa confirmada.',task:'Uma árvore de tarefa verificada, incluindo recursos registrados dos revisores de aprovação.',note:'Estimativa de preço-base, não uma fatura nem uma nota de qualidade.'},
  id:{unit:'USD ekuivalen API',reference:'Harga referensi pencapaian',coverage:'{percent}% memiliki harga; penggunaan tanpa harga tetap dalam total token.',unpriced:'Penggunaan belum memiliki harga.',
    total:'Akumulasi sumber daya API terverifikasi.',week:'Puncak minggu kalender yang telah selesai, mulai Senin, dalam zona waktu terpilih.',session:'Satu sesi lengkap yang terkonfirmasi.',task:'Satu pohon tugas terverifikasi, termasuk sumber daya peninjau persetujuan yang tercatat.',note:'Estimasi harga dasar, bukan tagihan atau penilaian kualitas tugas.'},
};
const earnedReferences:Record<SupportedLanguage,string>={
  en:'Awarded using', 'zh-CN':'授奖依据', 'zh-TW':'授獎依據',
  'de-DE':'Verliehen mit', ja:'授与時の参照価格', ko:'수여 당시 참조 가격',
  'pt-BR':'Concedido com', id:'Diberikan menggunakan',
};
export function achievementMoneyCopyFor(locale:string):Copy & {earnedReference:string} {
  const language=Object.prototype.hasOwnProperty.call(copies,locale)?locale as SupportedLanguage:'en';
  return {...copies[language],earnedReference:earnedReferences[language]};
}

import { SupportedLanguage } from './types';

export interface ApiHeatmapCopy {
  sourceIncomplete: string;
  apiEquivalent: string;
  tokens: string;
  estimated: string;
  exact: string;
  currentPricing: string;
  noData: string;
  unpriced: string;
  subtotal: string;
  coverage: string;
  notBill: string;
  missingLegend: string;
}

/** Compact artifact copy only; integration UI remains owned by I18n. */
const baseCopies: Record<SupportedLanguage, Omit<ApiHeatmapCopy,'sourceIncomplete'>> = {
  en: { apiEquivalent: 'API equivalent', tokens: 'Processed tokens', estimated: 'Estimated', exact: 'Exact model pricing', currentPricing: 'Current pricing', noData: 'No data', unpriced: 'Unpriced', subtotal: 'Priced subtotal', coverage: 'Coverage', notBill: 'Reference estimate; not a bill or subscription usage.', missingLegend: 'Gray: unpriced; outline: no data; dashed: partial pricing.' },
  'de-DE': { apiEquivalent: 'API-Äquivalent', tokens: 'Verarbeitete Token', estimated: 'Geschätzt', exact: 'Exakte Modellpreise', currentPricing: 'Aktuelle Preise', noData: 'Keine Daten', unpriced: 'Ohne Preis', subtotal: 'Bepreiste Teilsumme', coverage: 'Abdeckung', notBill: 'Referenzschätzung; keine Rechnung oder Abonutzung.', missingLegend: 'Grau: ohne Preis; Umriss: keine Daten; gestrichelt: Teilpreise.' },
  'zh-TW': { apiEquivalent: 'API 等價金額', tokens: '已處理 Token', estimated: '估算', exact: '精確型號定價', currentPricing: '目前定價', noData: '無資料', unpriced: '未定價', subtotal: '已定價小計', coverage: '覆蓋', notBill: '參考估值；不是帳單或訂閱用量。', missingLegend: '灰色：未定價；空框：無資料；虛線：部分定價。' },
  'zh-CN': { apiEquivalent: 'API 等价金额', tokens: '已处理 Token', estimated: '估算', exact: '精确型号定价', currentPricing: '当前定价', noData: '无数据', unpriced: '未定价', subtotal: '已定价小计', coverage: '覆盖', notBill: '参考估值；不是账单或订阅用量。', missingLegend: '灰色：未定价；空框：无数据；虚线：部分定价。' },
  ja: { apiEquivalent: 'API 相当額', tokens: '処理済みトークン', estimated: '推定', exact: '正確なモデル料金', currentPricing: '現在の料金', noData: 'データなし', unpriced: '料金不明', subtotal: '料金算出済み小計', coverage: '算出範囲', notBill: '参考推定額。請求額やサブスク使用量ではありません。', missingLegend: '灰色：料金不明、枠のみ：データなし、破線：一部算出。' },
  ko: { apiEquivalent: 'API 환산 금액', tokens: '처리된 토큰', estimated: '추정', exact: '정확한 모델 요금', currentPricing: '현재 요금', noData: '데이터 없음', unpriced: '요금 미확인', subtotal: '요금 확인 소계', coverage: '확인 범위', notBill: '참고 추정치이며 청구액이나 구독 사용량이 아닙니다.', missingLegend: '회색: 요금 미확인, 테두리: 데이터 없음, 점선: 일부 확인.' },
  'pt-BR': { apiEquivalent: 'Equivalente de API', tokens: 'Tokens processados', estimated: 'Estimado', exact: 'Preços exatos por modelo', currentPricing: 'Preços atuais', noData: 'Sem dados', unpriced: 'Sem preço', subtotal: 'Subtotal precificado', coverage: 'Cobertura', notBill: 'Estimativa de referência; não é fatura nem uso da assinatura.', missingLegend: 'Cinza: sem preço; contorno: sem dados; tracejado: preço parcial.' },
  id: { apiEquivalent: 'Setara API', tokens: 'Token diproses', estimated: 'Perkiraan', exact: 'Harga model tepat', currentPricing: 'Harga saat ini', noData: 'Tidak ada data', unpriced: 'Tanpa harga', subtotal: 'Subtotal berharga', coverage: 'Cakupan', notBill: 'Perkiraan referensi; bukan tagihan atau pemakaian langganan.', missingLegend: 'Abu-abu: tanpa harga; garis tepi: tanpa data; putus-putus: sebagian.' },
};
const incompleteCopies:Record<SupportedLanguage,string>={
  en:'Indexed subtotal; source history incomplete',
  'de-DE':'Indizierte Teilsumme; Quellhistorie unvollständig',
  'zh-TW':'已索引小計；來源歷史尚未完整', 'zh-CN':'已索引小计；来源历史尚未完整',
  ja:'索引済み小計。元の履歴は未完了', ko:'색인된 소계이며 원본 이력이 불완전합니다',
  'pt-BR':'Subtotal indexado; histórico da origem incompleto',
  id:'Subtotal terindeks; riwayat sumber belum lengkap',
};
export const API_HEATMAP_COPY:Record<SupportedLanguage,ApiHeatmapCopy> = Object.fromEntries(
  Object.entries(baseCopies).map(([locale,copy])=>[locale,{...copy,sourceIncomplete:incompleteCopies[locale as SupportedLanguage]}]),
) as Record<SupportedLanguage,ApiHeatmapCopy>;

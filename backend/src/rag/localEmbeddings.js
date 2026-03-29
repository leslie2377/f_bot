const { Embeddings } = require('@langchain/core/embeddings');
const crypto = require('crypto');

/**
 * 로컬 TF-IDF 기반 임베딩 (API 호출 없음, 무료)
 * - 한국어 키워드 기반 벡터 생성
 * - 외부 의존성 없이 동작
 * - 프리티 도메인 특화 키워드 사전 포함
 */
class LocalKoreanEmbeddings extends Embeddings {
  constructor() {
    super({});
    this.dimension = 384;
    // 프리티 도메인 키워드 사전 (가중치 부여)
    this.domainKeywords = [
      '개통', '셀프개통', '유심', 'esim', '이심', '요금제', '요금', '가격', '데이터',
      '통화', '문자', '무제한', 'skt', 'kt', 'lgu', '프로모션', '할인', '제휴',
      '번호이동', '신규가입', '해지', '약관', '계약', '환불', '납부', '결제', '자동이체',
      '고객센터', '상담', '문의', '준비물', '신분증', '인증', '안면인증', '본인인증',
      '미성년자', '외국인', '법인', '회선', '선불', '후불', '충전', '잔액',
      '프로파일', 'qr', '활성화', '부가서비스', '청구서', '번호변경',
      '하나은행', '신한카드', 'cu', 'nh', '밀리의서재',
      '5g', 'lte', '5gb', '7gb', '10gb', '15gb', '20gb', '30gb', '50gb', '100gb',
      '100원', '2750원', '3630원', '무약정', '평생',
      '편의점', '배송', '바로유심', '원칩', '교체', '무료교체',
      '이메일', '팩스', '온라인', '채팅', '1:1',
    ];
  }

  async embedDocuments(texts) {
    return texts.map(text => this._embed(text));
  }

  async embedQuery(text) {
    return this._embed(text);
  }

  _embed(text) {
    const lower = text.toLowerCase();
    const vector = new Float32Array(this.dimension);

    // 1. 도메인 키워드 매칭 (0~127 차원)
    this.domainKeywords.forEach((kw, i) => {
      if (i < 128) {
        const count = (lower.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        vector[i] = count > 0 ? Math.min(count * 0.5, 1.0) : 0;
      }
    });

    // 2. 문자 n-gram 해시 (128~255 차원) - 의미 유사도
    const chars = lower.replace(/\s+/g, '');
    for (let i = 0; i < chars.length - 1; i++) {
      const bigram = chars.slice(i, i + 2);
      const hash = this._hash(bigram) % 128;
      vector[128 + hash] += 0.3;
    }

    // 3. 단어 해시 (256~383 차원) - 단어 수준 매칭
    const words = lower.split(/\s+/).filter(w => w.length > 1);
    words.forEach(word => {
      const hash = this._hash(word) % 128;
      vector[256 + hash] += 0.4;
    });

    // L2 정규화
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
    return Array.from(vector.map(v => v / norm));
  }

  _hash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }
}

module.exports = { LocalKoreanEmbeddings };

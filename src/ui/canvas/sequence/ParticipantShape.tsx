import type { ReactNode } from 'react';
import type { ParticipantType } from '../../../core/diagrams/sequence/model';
import type { ThemeColors } from '../../../core/theme';
import { SEQ, TYPO } from '../../../core/theme';

interface ParticipantShapeProps {
  type: ParticipantType;
  fill?: string;
  theme: ThemeColors;
  /** 라벨 영역 (머리: 편집 가능, 꼬리: 정적) */
  children: ReactNode;
}

/** 참여자 도형 — 머리(SeqParticipantNode)와 꼬리(SeqBody 하단)가 같은 모양을 쓴다 */
export function ParticipantShape({ type, fill, theme, children }: ParticipantShapeProps) {
  if (type === 'actor') {
    const stroke = theme.nodeBorder;
    return (
      <div style={{
        width: '100%', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center',
        background: fill ?? 'transparent', borderRadius: 4, fontFamily: TYPO.fontFamily,
      }}>
        <svg width={28} height={SEQ.actorFigure} viewBox="0 0 28 34" aria-hidden="true" style={{ flexShrink: 0 }}>
          <circle cx="14" cy="6" r="5" fill="none" stroke={stroke} strokeWidth="1.8" />
          <line x1="14" y1="11" x2="14" y2="23" stroke={stroke} strokeWidth="1.8" />
          <line x1="4" y1="15" x2="24" y2="15" stroke={stroke} strokeWidth="1.8" />
          <line x1="14" y1="23" x2="6" y2="33" stroke={stroke} strokeWidth="1.8" />
          <line x1="14" y1="23" x2="22" y2="33" stroke={stroke} strokeWidth="1.8" />
        </svg>
        <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: `0 ${SEQ.headPadX}px` }}>
          {children}
        </div>
      </div>
    );
  }
  return (
    <div style={{
      width: '100%', height: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: `${SEQ.headPadY}px ${SEQ.headPadX}px`, background: fill ?? theme.participantBg,
      border: `${TYPO.border}px solid ${theme.nodeBorder}`, borderRadius: 5, fontFamily: TYPO.fontFamily,
    }}>
      {children}
    </div>
  );
}

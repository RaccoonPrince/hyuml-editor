import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { useDiagramStore } from '../store/useDiagramStore';

interface Props {
  /** 사용자에게 보여줄 영역 이름 (예: '캔버스') */
  name: string;
  children: ReactNode;
}

interface State { error: Error | null }

/**
 * 렌더 중 예외가 나도 앱 전체가 흰 화면이 되지 않도록 영역별로 격리한다.
 * 캔버스가 죽어도 코드 창은 살아 있어 사용자가 원인을 고칠 수 있다.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.name}]`, error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  private undoAndReset = () => {
    useDiagramStore.getState().undo();
    this.reset();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const canUndo = useDiagramStore.getState().past.length > 0;
    return (
      <div role="alert" style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
        width: '100%', height: '100%', padding: 24, textAlign: 'center', background: '#fff7f7', color: '#7f1d1d',
      }}>
        <strong style={{ fontSize: 16 }}>{this.props.name}에서 오류가 발생했습니다.</strong>
        <code style={{ maxWidth: 520, whiteSpace: 'pre-wrap', fontSize: 12, color: '#991b1b' }}>{error.message}</code>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={this.reset} style={buttonStyle}>다시 시도</button>
          {canUndo && <button type="button" onClick={this.undoAndReset} style={buttonStyle}>실행 취소 후 다시 시도</button>}
        </div>
      </div>
    );
  }
}

const buttonStyle = {
  padding: '6px 14px', borderRadius: 4, border: '1px solid #b91c1c', background: '#fff', color: '#b91c1c', cursor: 'pointer', fontWeight: 600,
} as const;

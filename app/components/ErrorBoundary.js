'use client';
import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center', color: '#fff', background: '#0a0d14', minHeight: '100vh' }}>
          <h2 style={{ color: '#e8b339', fontFamily: 'system-ui', marginBottom: 12 }}>Something went wrong</h2>
          <p style={{ color: '#999', fontSize: 14, marginBottom: 20 }}>{this.state.error?.message || 'Unknown error'}</p>
          <button onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            style={{ padding: '10px 24px', borderRadius: 8, background: '#e8b339', color: '#000', fontWeight: 600, border: 'none', cursor: 'pointer' }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

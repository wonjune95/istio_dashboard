import { Component, type ReactNode } from 'react'

// Catches render errors (e.g. rjsf choking on an unusual schema) so the rest of
// the page — crucially the YAML tab — keeps working.
export class ErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}

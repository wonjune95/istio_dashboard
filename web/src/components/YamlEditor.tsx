import CodeMirror from '@uiw/react-codemirror'
import { yaml } from '@codemirror/lang-yaml'
import { indentationMarkers } from '@replit/codemirror-indentation-markers'
import { useTheme } from '../ui/theme'

// YAML은 들여쓰기가 곧 문법이라 단계마다 세로 가이드라인(|)을 그려서
// 한 칸 어긋남을 바로 볼 수 있게 한다. 커서가 있는 블록은 진하게 강조.
const whitespaceExtensions = [
  indentationMarkers({
    highlightActiveBlock: true,
    thickness: 1.5,
    colors: {
      light: '#cbd5e1',
      dark: '#475569',
      activeLight: '#64748b',
      activeDark: '#94a3b8',
    },
  }),
]

export function YamlEditor({
  value,
  onChange,
  readOnly = false,
}: {
  value: string
  onChange?: (v: string) => void
  readOnly?: boolean
}) {
  const { theme } = useTheme()
  return (
    <div className="overflow-hidden rounded border border-base">
      <CodeMirror
        value={value}
        height="440px"
        theme={theme === 'dark' ? 'dark' : 'light'}
        extensions={[yaml(), ...whitespaceExtensions]}
        editable={!readOnly}
        onChange={onChange}
      />
    </div>
  )
}

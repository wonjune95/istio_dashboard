import CodeMirror from '@uiw/react-codemirror'
import { yaml } from '@codemirror/lang-yaml'
import { useTheme } from '../ui/theme'

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
        extensions={[yaml()]}
        editable={!readOnly}
        onChange={onChange}
      />
    </div>
  )
}

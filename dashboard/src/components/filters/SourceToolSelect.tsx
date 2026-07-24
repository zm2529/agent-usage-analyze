import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLanguage } from '@/i18n/LanguageProvider';
export const SOURCE_TOOLS = [
  { value: 'codex-cli', label: 'Codex', support: 'full' },
  { value: 'claude-code', label: 'Claude Code', support: 'sessions' },
  { value: 'cursor', label: 'Cursor', support: 'sessions' },
  { value: 'copilot-cli', label: 'GitHub Copilot CLI', support: 'sessions' },
  { value: 'copilot', label: 'GitHub Copilot', support: 'sessions' },
] as const;

// Extract the dot color class from SOURCE_TOOL_COLORS badge string (e.g. "bg-orange-500/10 text-orange-600 ...")
// We only need the text color for the dot background — use the bg-*-500/10 converted to bg-*-500
const DOT_COLORS: Record<string, string> = {
  'codex-cli': 'bg-green-500',
  'claude-code': 'bg-orange-500',
  cursor: 'bg-blue-500',
  'copilot-cli': 'bg-cyan-500',
  copilot: 'bg-violet-500',
};

interface SourceToolSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}

export function SourceToolSelect({ value, onValueChange, className }: SourceToolSelectProps) {
  const { language } = useLanguage();
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={language === 'zh-CN' ? '全部来源' : 'All sources'} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{language === 'zh-CN' ? '全部来源' : 'All sources'}</SelectItem>
        {SOURCE_TOOLS.map((tool) => (
          <SelectItem key={tool.value} value={tool.value}>
            <span className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full shrink-0 ${DOT_COLORS[tool.value]}`} />
              <span>{tool.label}</span>
              <span className="text-xs text-muted-foreground">
                {tool.support === 'full'
                  ? (language === 'zh-CN' ? '完整支持' : 'full support')
                  : (language === 'zh-CN' ? '会话分析' : 'session analytics')}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
